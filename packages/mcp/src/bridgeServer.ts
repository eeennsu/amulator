import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  bridgeResponseSchema,
  SNAPSHOT_TOKEN_HEADER,
  type BridgeRequest,
  type ProgramName,
} from '@amulator/core/control/protocol';

export class BridgeTimeoutError extends Error {}
export class BridgeDisconnectedError extends Error {}
// The emulator page answered with a JSON-RPC error.
export class BridgePageError extends Error {}

export const BRIDGE_TIMEOUT_MS = 10_000;
// How long a request waits for a tab to connect before failing with the not-connected error.
export const CONNECT_WAIT_MS = 5_000;
export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

export type BridgeServer = {
  readonly port: number;
  readonly token: string;
  pageUrl: (program: ProgramName) => string;
  isConnected: () => boolean;
  request: (
    method: BridgeRequest['method'],
    params: object,
    timeoutMs?: number,
  ) => Promise<unknown>;
  close: () => Promise<void>;
};

const HOST = '127.0.0.1';
const BRIDGE_PATH = '/bridge';
const SNAPSHOT_PREFIX = '/snapshots/';
const SNAPSHOT_KEY = /^[0-9a-f]{64}$/;
const SNAPSHOT_SUFFIX = '.amus.gz';
// Responses are small JSON (a screenshot is one base64 PNG); snapshots travel over HTTP, not here.
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const CLOSE_REPLACED = 4000;
const TEMP_REMOVE_RETRIES = 5;
const NOT_CONNECTED =
  'No emulator tab is connected. If you just called emulator_open, the tab may still be loading — ' +
  'retry in a few seconds. Call emulator_open again only if no browser tab was opened.';

const HTTP = {
  ok: 200,
  noContent: 204,
  badRequest: 400,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  payloadTooLarge: 413,
  internal: 500,
} as const;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.elf': 'application/octet-stream',
  '.wasm': 'application/wasm',
};
const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

class PayloadTooLargeError extends Error {}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type Connection = {
  socket: WebSocket;
  pending: Map<number, Pending>;
};

// A request that arrived before any tab connected.
type Waiter = {
  connected: (connection: Connection) => void;
  abort: (error: Error) => void;
};

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

// Not `new URL(...)`: that would normalize `..` segments before the root check sees them.
const splitTarget = (target: string): { pathname: string; search: URLSearchParams } => {
  const queryStart = target.indexOf('?');
  return {
    pathname: queryStart === -1 ? target : target.slice(0, queryStart),
    search: new URLSearchParams(queryStart === -1 ? '' : target.slice(queryStart + 1)),
  };
};

const reply = (
  res: ServerResponse,
  status: number,
  headers: Record<string, string | number> = {},
): void => {
  res.writeHead(status, { 'Content-Length': 0, ...headers });
  res.end();
};

const tokenHeaderValue = (headers: IncomingHttpHeaders): string | undefined => {
  const value = headers[SNAPSHOT_TOKEN_HEADER.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
};

// Maps a request path to a file under root, or undefined when it would leave root.
const resolveStaticPath = (root: string, rawPath: string): string | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\'))
    return undefined;
  const target = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  const relative = path.relative(root, target);
  const inside =
    relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
  return inside ? target : undefined;
};

export const startBridgeServer = async (options: {
  webRoot: string;
  dataDir: string;
  maxSnapshotBytes?: number;
  connectWaitMs?: number;
}): Promise<BridgeServer> => {
  const webRoot = path.resolve(options.webRoot);
  const dataDir = path.resolve(options.dataDir);
  const maxSnapshotBytes = options.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES;
  const connectWaitMs = options.connectWaitMs ?? CONNECT_WAIT_MS;
  const token = randomUUID();
  await mkdir(dataDir, { recursive: true });

  let port = 0;
  let nextId = 1;
  let active: Connection | undefined;
  const waiters = new Set<Waiter>();

  const failPending = (connection: Connection, error: Error): void => {
    const pending = [...connection.pending.values()];
    connection.pending.clear();
    for (const entry of pending) entry.reject(error);
  };

  const handleMessage = (connection: Connection, text: string): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      console.error('bridge: ignored a non-JSON frame from the page');
      return;
    }
    const parsed = bridgeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('bridge: ignored a malformed response from the page');
      return;
    }
    const response = parsed.data;
    const take = (id: number): Pending | undefined => {
      const entry = connection.pending.get(id);
      connection.pending.delete(id);
      return entry;
    };
    if (!('error' in response)) {
      take(response.id)?.resolve(response.result);
    } else if (response.id === null) {
      // The page could not read the request id, so no pending request can match it.
      console.error(`bridge: page rejected a request: ${response.error.message}`);
    } else {
      const message = `${response.error.message} (code ${response.error.code})`;
      take(response.id)?.reject(new BridgePageError(message));
    }
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  wss.on('connection', (socket) => {
    const connection: Connection = { socket, pending: new Map() };
    if (active) {
      failPending(
        active,
        new BridgeDisconnectedError('The emulator tab was replaced by a newer connection.'),
      );
      active.socket.close(CLOSE_REPLACED, 'replaced');
    }
    active = connection;
    for (const waiter of waiters) waiter.connected(connection);
    waiters.clear();
    socket.on('message', (data, isBinary) => {
      if (isBinary || !Buffer.isBuffer(data)) {
        console.error('bridge: ignored a binary frame from the page');
        return;
      }
      handleMessage(connection, data.toString('utf8'));
    });
    socket.on('error', (error) => console.error(`bridge: socket error: ${error.message}`));
    socket.on('close', () => {
      failPending(connection, new BridgeDisconnectedError('The emulator tab disconnected.'));
      if (active === connection) active = undefined;
    });
  });

  const rejectUpgrade = (socket: Duplex): void => {
    socket.on('error', () => undefined);
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () =>
      socket.destroy(),
    );
  };

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const { pathname, search } = splitTarget(req.url ?? '');
    const given = search.get('token');
    const allowed =
      pathname === BRIDGE_PATH &&
      given !== null &&
      safeEqual(given, token) &&
      req.headers.origin === `http://${HOST}:${port}`;
    if (!allowed) {
      rejectUpgrade(socket);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };

  const tooLarge = (req: IncomingMessage, res: ServerResponse): void => {
    reply(res, HTTP.payloadTooLarge, { Connection: 'close' });
    // Stop reading the rest of the body once the response is on the wire.
    res.once('finish', () => req.destroy());
  };

  const putSnapshot = async (
    req: IncomingMessage,
    res: ServerResponse,
    file: string,
  ): Promise<void> => {
    if (Number(req.headers['content-length']) > maxSnapshotBytes) {
      tooLarge(req, res);
      return;
    }
    const temp = `${file}.${randomUUID()}.tmp`;
    let received = 0;
    try {
      // destroyOnReturn: false keeps the socket alive on failure, so the 413 can still be sent.
      await pipeline(
        req.iterator({ destroyOnReturn: false }),
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            received += chunk.length;
            if (received > maxSnapshotBytes) throw new PayloadTooLargeError();
            yield chunk;
          }
        },
        createWriteStream(temp, { flags: 'wx' }),
      );
      await rename(temp, file);
    } catch (error) {
      // Retries cover Windows still holding the temp file while its write stream closes.
      await rm(temp, { force: true, maxRetries: TEMP_REMOVE_RETRIES });
      if (error instanceof PayloadTooLargeError) tooLarge(req, res);
      // Otherwise the client went away mid-upload or the disk failed.
      else if (!req.socket.destroyed) reply(res, HTTP.internal);
      return;
    }
    reply(res, HTTP.noContent);
  };

  const getSnapshot = async (res: ServerResponse, file: string): Promise<void> => {
    const handle = await open(file, 'r').catch(() => undefined);
    if (!handle) {
      reply(res, HTTP.notFound);
      return;
    }
    // Size comes from the open handle, so a concurrent rename cannot make it disagree with the body.
    const { size } = await handle.stat().catch(async (error: unknown) => {
      await handle.close();
      throw error;
    });
    res.writeHead(HTTP.ok, { 'Content-Type': 'application/gzip', 'Content-Length': size });
    await pipeline(handle.createReadStream(), res).catch(() => undefined);
  };

  const handleSnapshot = async (
    req: IncomingMessage,
    res: ServerResponse,
    key: string,
  ): Promise<void> => {
    const given = tokenHeaderValue(req.headers);
    if (given === undefined || !safeEqual(given, token)) {
      reply(res, HTTP.forbidden);
      return;
    }
    if (!SNAPSHOT_KEY.test(key)) {
      reply(res, HTTP.badRequest);
      return;
    }
    const file = path.join(dataDir, `${key}${SNAPSHOT_SUFFIX}`);
    switch (req.method) {
      case 'GET':
        return getSnapshot(res, file);
      case 'PUT':
        return putSnapshot(req, res, file);
      case 'DELETE':
        await rm(file, { force: true });
        reply(res, HTTP.noContent);
        return;
      default:
        reply(res, HTTP.methodNotAllowed, { Allow: 'GET, PUT, DELETE' });
    }
  };

  const handleStatic = async (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply(res, HTTP.methodNotAllowed, { Allow: 'GET, HEAD' });
      return;
    }
    const file = resolveStaticPath(webRoot, pathname);
    // A directory or any other unreadable target fails the read and becomes a 404 too.
    const body = file === undefined ? undefined : await readFile(file).catch(() => undefined);
    if (file === undefined || body === undefined) {
      reply(res, HTTP.notFound);
      return;
    }
    res.writeHead(HTTP.ok, {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? FALLBACK_CONTENT_TYPE,
      'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const { pathname } = splitTarget(req.url ?? '');
    if (pathname.startsWith(SNAPSHOT_PREFIX)) {
      await handleSnapshot(req, res, pathname.slice(SNAPSHOT_PREFIX.length));
    } else {
      await handleStatic(req, res, pathname);
    }
  };

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error(
        `bridge: request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.headersSent) reply(res, HTTP.internal);
      else res.destroy();
    });
  });
  server.on('upgrade', handleUpgrade);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('bridge: no TCP address');
  port = address.port;

  // The page needs a moment to load after emulator_open, so a request waits for the first tab.
  const waitForConnection = (): Promise<Connection> => {
    if (active) return Promise.resolve(active);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new BridgeDisconnectedError(NOT_CONNECTED));
      }, connectWaitMs);
      const waiter: Waiter = {
        connected: (connection) => {
          clearTimeout(timer);
          resolve(connection);
        },
        abort: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      waiters.add(waiter);
    });
  };

  // The response timeout starts here, when the request is actually sent.
  const send = (
    connection: Connection,
    method: BridgeRequest['method'],
    params: object,
    timeoutMs: number,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        reject(
          new BridgeTimeoutError(`The emulator did not answer ${method} within ${timeoutMs} ms.`),
        );
      }, timeoutMs);
      connection.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      connection.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), (error) => {
        if (!error) return;
        connection.pending.delete(id);
        clearTimeout(timer);
        reject(new BridgeDisconnectedError(`Could not send ${method}: ${error.message}`));
      });
    });

  return {
    port,
    token,
    pageUrl: (program) => `http://${HOST}:${port}/?program=${program}&token=${token}`,
    isConnected: () => active !== undefined,
    request: async (method, params, timeoutMs = BRIDGE_TIMEOUT_MS) =>
      send(await waitForConnection(), method, params, timeoutMs),
    close: async () => {
      const closed = new BridgeDisconnectedError('The bridge server closed.');
      for (const waiter of waiters) waiter.abort(closed);
      waiters.clear();
      if (active) failPending(active, closed);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
};
