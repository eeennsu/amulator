import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { parseBridgeRequest, SNAPSHOT_TOKEN_HEADER } from '@amulator/core/control/protocol';

import {
  BridgeDisconnectedError,
  BridgePageError,
  BridgeTimeoutError,
  startBridgeServer,
  type BridgeServer,
} from '../src/bridgeServer';
import { frameText } from './frameText';

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: Buffer };

// node:http sends the path verbatim; fetch would normalize `..` before it left the client.
const send = (
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; chunks?: Buffer[] },
): Promise<HttpResult> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(parts),
          }),
        );
      },
    );
    req.on('error', reject);
    const chunks = options.chunks ?? [];
    for (const chunk of chunks.slice(0, -1)) req.write(chunk);
    req.end(chunks.at(-1));
  });

const KEY = 'a'.repeat(64);

let base: string;
let webRoot: string;
let dataDir: string;
const servers: BridgeServer[] = [];
const sockets: WebSocket[] = [];

const start = async (maxSnapshotBytes?: number): Promise<BridgeServer> => {
  const server = await startBridgeServer({ webRoot, dataDir, maxSnapshotBytes });
  servers.push(server);
  return server;
};

const connectPage = (
  server: BridgeServer,
  options: { token?: string; origin?: string; pathname?: string } = {},
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${server.port}${options.pathname ?? '/bridge'}?token=${options.token ?? server.token}`;
    const socket = new WebSocket(url, {
      origin: options.origin ?? `http://127.0.0.1:${server.port}`,
    });
    sockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

// A stand-in for the emulator page: answers every valid request with `result`.
const answerWith = (socket: WebSocket, result: unknown): void => {
  socket.on('message', (data) => {
    const parsed = parseBridgeRequest(frameText(data));
    if ('request' in parsed)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.request.id, result }));
  });
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'amulator-mcp-'));
  webRoot = path.join(base, 'web');
  dataDir = path.join(base, 'data');
  await mkdir(path.join(webRoot, 'assets'), { recursive: true });
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>t</title>');
  await writeFile(path.join(webRoot, 'assets', 'a.js'), 'export {};');
  await writeFile(path.join(base, 'package.json'), '{"secret":true}');
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await rm(base, { recursive: true, force: true });
});

describe('static files', () => {
  it('serves index.html at / and javascript with its content type', async () => {
    const server = await start();
    const index = await send(server.port, { path: '/' });
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.body.toString()).toContain('<title>t</title>');
    const script = await send(server.port, { path: '/assets/a.js' });
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    const server = await start();
    const head = await send(server.port, { method: 'HEAD', path: '/' });
    expect(head.status).toBe(200);
    expect(head.body).toHaveLength(0);
    expect((await send(server.port, { method: 'POST', path: '/' })).status).toBe(405);
  });

  it('does not list directories or serve missing files', async () => {
    const server = await start();
    expect((await send(server.port, { path: '/assets/' })).status).toBe(404);
    expect((await send(server.port, { path: '/assets' })).status).toBe(404);
    expect((await send(server.port, { path: '/nope.js' })).status).toBe(404);
  });

  it.each([
    '/../package.json',
    '/%2e%2e/package.json',
    '/%2e%2e%2fpackage.json',
    '/assets/../../package.json',
    '/..%5cpackage.json',
    '/assets%5c..%5c..%5cpackage.json',
    '/index.html%00.js',
    '/%zz',
  ])('does not serve %s from outside the web root', async (target) => {
    const server = await start();
    const result = await send(server.port, { path: target });
    expect(result.status).toBe(404);
    expect(result.body.toString()).not.toContain('secret');
  });
});

describe('websocket bridge', () => {
  it('rejects a wrong token, another path, and a foreign origin', async () => {
    const server = await start();
    await expect(connectPage(server, { token: 'wrong' })).rejects.toThrow(/403/);
    await expect(connectPage(server, { pathname: '/elsewhere' })).rejects.toThrow(/403/);
    await expect(connectPage(server, { origin: 'http://evil.example' })).rejects.toThrow(/403/);
    await expect(
      connectPage(server, { origin: `http://localhost:${server.port}` }),
    ).rejects.toThrow(/403/);
    expect(server.isConnected()).toBe(false);
  });

  it('forwards a request to the page and returns its result', async () => {
    const server = await start();
    const page = await connectPage(server);
    answerWith(page, { ok: true });
    expect(server.isConnected()).toBe(true);
    await expect(server.request('tap', { x: 1, y: 2 })).resolves.toEqual({ ok: true });
  });

  it('numbers requests with an incrementing integer id', async () => {
    const server = await start();
    const page = await connectPage(server);
    const ids: number[] = [];
    page.on('message', (data) => {
      const parsed = parseBridgeRequest(frameText(data));
      if ('request' in parsed) {
        ids.push(parsed.request.id);
        page.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.request.id, result: {} }));
      }
    });
    await server.request('pause', {});
    await server.request('resume', {});
    expect(ids[1]).toBe((ids[0] ?? 0) + 1);
  });

  it('rejects with a hint to call emulator_open when no tab is connected', async () => {
    const server = await start();
    const failure = server.request('tap', { x: 1, y: 2 });
    await expect(failure).rejects.toBeInstanceOf(BridgeDisconnectedError);
    await expect(failure).rejects.toThrow('emulator_open');
  });

  it('rejects with BridgeTimeoutError when the page does not answer', async () => {
    const server = await start();
    await connectPage(server);
    await expect(server.request('tap', { x: 1, y: 2 }, 100)).rejects.toBeInstanceOf(
      BridgeTimeoutError,
    );
  });

  it('rejects with BridgePageError when the page answers with an error', async () => {
    const server = await start();
    const page = await connectPage(server);
    page.on('message', (data) => {
      const parsed = parseBridgeRequest(frameText(data));
      if ('request' in parsed) {
        const error = { code: -32000, message: 'not booted' };
        page.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.request.id, error }));
      }
    });
    const failure = server.request('tap', { x: 1, y: 2 });
    await expect(failure).rejects.toBeInstanceOf(BridgePageError);
    await expect(failure).rejects.toThrow('not booted');
  });

  it('ignores error responses with a null id instead of failing a pending request', async () => {
    const server = await start();
    const page = await connectPage(server);
    page.on('message', () => {
      page.send(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'bad' } }),
      );
      page.send(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    });
    await expect(server.request('tap', { x: 1, y: 2 })).resolves.toEqual({ ok: true });
  });

  it('lets the newest connection win and fails requests on the replaced one', async () => {
    const server = await start();
    const first = await connectPage(server);
    const firstClosed = new Promise((resolve) => first.once('close', resolve));
    const stranded = server.request('tap', { x: 1, y: 2 });
    const strandedFailure = expect(stranded).rejects.toBeInstanceOf(BridgeDisconnectedError);
    const second = await connectPage(server);
    answerWith(second, { ok: true });
    await strandedFailure;
    await firstClosed;
    await expect(server.request('tap', { x: 3, y: 4 })).resolves.toEqual({ ok: true });
  });

  it('fails a pending request when the page disconnects', async () => {
    const server = await start();
    const page = await connectPage(server);
    const pending = server.request('screenshot', {});
    const failure = expect(pending).rejects.toBeInstanceOf(BridgeDisconnectedError);
    page.close();
    await failure;
    expect(server.isConnected()).toBe(false);
  });
});

describe('startBridgeServer', () => {
  it('gives each server its own port and token', async () => {
    const [one, two] = [await start(), await start()];
    expect(one.port).not.toBe(two.port);
    expect(one.token).not.toBe(two.token);
    expect((await send(one.port, { path: '/' })).status).toBe(200);
    expect((await send(two.port, { path: '/' })).status).toBe(200);
  });

  it('builds the page url with the program and token', async () => {
    const server = await start();
    expect(server.pageUrl('clock')).toBe(
      `http://127.0.0.1:${server.port}/?program=clock&token=${server.token}`,
    );
  });
});

describe('snapshot endpoint', () => {
  const headers = (server: BridgeServer): Record<string, string> => ({
    [SNAPSHOT_TOKEN_HEADER]: server.token,
  });

  it('rejects a missing or wrong token before anything else', async () => {
    const server = await start();
    const body = [Buffer.from('x')];
    expect(
      (await send(server.port, { method: 'PUT', path: `/snapshots/${KEY}`, chunks: body })).status,
    ).toBe(403);
    // Even a bad key gets 403 first, so the key format cannot be probed without the token.
    expect((await send(server.port, { path: '/snapshots/abc' })).status).toBe(403);
    const wrong = { [SNAPSHOT_TOKEN_HEADER]: 'nope' };
    expect((await send(server.port, { path: `/snapshots/${KEY}`, headers: wrong })).status).toBe(
      403,
    );
    await expect(readdir(dataDir)).resolves.toEqual([]);
  });

  it.each(['abc', '../x', '..%2fx', KEY.toUpperCase(), `${KEY}0`, ''])(
    'rejects the key %j with 400',
    async (key) => {
      const server = await start();
      const result = await send(server.port, {
        method: 'PUT',
        path: `/snapshots/${key}`,
        headers: headers(server),
        chunks: [Buffer.from('x')],
      });
      expect(result.status).toBe(400);
      await expect(readdir(dataDir)).resolves.toEqual([]);
    },
  );

  it('rejects other methods with 405', async () => {
    const server = await start();
    const result = await send(server.port, {
      method: 'POST',
      path: `/snapshots/${KEY}`,
      headers: headers(server),
    });
    expect(result.status).toBe(405);
  });

  it('stores bytes under <dataDir>/<key>.amus.gz and returns them', async () => {
    const server = await start(1024);
    const bytes = Buffer.from([0x1f, 0x8b, 0, 1, 2, 3, 255]);
    const put = await send(server.port, {
      method: 'PUT',
      path: `/snapshots/${KEY}`,
      headers: headers(server),
      chunks: [bytes],
    });
    expect(put.status).toBeLessThan(300);
    await expect(readFile(path.join(dataDir, `${KEY}.amus.gz`))).resolves.toEqual(bytes);
    await expect(readdir(dataDir)).resolves.toEqual([`${KEY}.amus.gz`]);
    const got = await send(server.port, { path: `/snapshots/${KEY}`, headers: headers(server) });
    expect(got.status).toBe(200);
    expect(got.body).toEqual(bytes);
  });

  it('replaces an existing snapshot', async () => {
    const server = await start();
    for (const text of ['first', 'second']) {
      await send(server.port, {
        method: 'PUT',
        path: `/snapshots/${KEY}`,
        headers: headers(server),
        chunks: [Buffer.from(text)],
      });
    }
    const got = await send(server.port, { path: `/snapshots/${KEY}`, headers: headers(server) });
    expect(got.body.toString()).toBe('second');
  });

  it('answers 413 when the declared length is over the limit', async () => {
    const server = await start(1024);
    const result = await send(server.port, {
      method: 'PUT',
      path: `/snapshots/${KEY}`,
      headers: headers(server),
      chunks: [Buffer.alloc(2000)],
    });
    expect(result.status).toBe(413);
    await expect(readdir(dataDir)).resolves.toEqual([]);
  });

  it('answers 413 for a chunked body that grows past the limit and leaves no file behind', async () => {
    const server = await start(1024);
    const result = await send(server.port, {
      method: 'PUT',
      path: `/snapshots/${KEY}`,
      headers: headers(server),
      chunks: [Buffer.alloc(600), Buffer.alloc(600)],
    });
    expect(result.status).toBe(413);
    await expect(readdir(dataDir)).resolves.toEqual([]);
  });

  it('keeps the previous snapshot when a replacement is too large', async () => {
    const server = await start(1024);
    const url = `/snapshots/${KEY}`;
    await send(server.port, {
      method: 'PUT',
      path: url,
      headers: headers(server),
      chunks: [Buffer.from('old')],
    });
    const result = await send(server.port, {
      method: 'PUT',
      path: url,
      headers: headers(server),
      chunks: [Buffer.alloc(600), Buffer.alloc(600)],
    });
    expect(result.status).toBe(413);
    const got = await send(server.port, { path: url, headers: headers(server) });
    expect(got.body.toString()).toBe('old');
  });

  it('returns 404 for an unknown key and after DELETE; DELETE of an unknown key succeeds', async () => {
    const server = await start();
    const url = `/snapshots/${KEY}`;
    expect((await send(server.port, { path: url, headers: headers(server) })).status).toBe(404);
    await send(server.port, {
      method: 'PUT',
      path: url,
      headers: headers(server),
      chunks: [Buffer.from('x')],
    });
    expect(
      (await send(server.port, { method: 'DELETE', path: url, headers: headers(server) })).status,
    ).toBeLessThan(300);
    expect((await send(server.port, { path: url, headers: headers(server) })).status).toBe(404);
    expect(
      (await send(server.port, { method: 'DELETE', path: url, headers: headers(server) })).status,
    ).toBeLessThan(300);
  });

  it('creates a missing dataDir', async () => {
    const nested = path.join(base, 'a', 'b');
    const server = await startBridgeServer({ webRoot, dataDir: nested });
    servers.push(server);
    await expect(readdir(nested)).resolves.toEqual([]);
  });
});
