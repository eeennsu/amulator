import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { parseBridgeRequest } from '@amulator/core/control/protocol';

import { TOOL_NAMES } from '../src/tools';
import { frameText } from './frameText';

const STARTUP_TIMEOUT_MS = 60_000;
const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

let client: Client;
let base: string;
let page: WebSocket | undefined;

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

const textOf = (result: ToolResult): string => {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
};

const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
  client.callTool({ name, arguments: args });

// Connects a stand-in page that answers each bridge method with the given result (or error).
const connectPage = async (
  url: string,
  answers: Record<string, unknown>,
  error?: { code: number; message: string },
): Promise<WebSocket> => {
  const { port, searchParams } = new URL(url);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge?token=${searchParams.get('token')}`, {
    origin: `http://127.0.0.1:${port}`,
  });
  socket.on('message', (data) => {
    const parsed = parseBridgeRequest(frameText(data));
    if (!('request' in parsed)) return;
    const { id, method } = parsed.request;
    const reply = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result: answers[method] };
    socket.send(JSON.stringify(reply));
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
};

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'amulator-tools-'));
  const webRoot = path.join(base, 'web');
  client = new Client({ name: 'tools-test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        'tsx',
        'src/server.ts',
        '--web-root',
        webRoot,
        '--data-dir',
        path.join(base, 'data'),
      ],
      cwd: PACKAGE_DIR,
    }),
  );
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  page?.terminate();
  await client?.close();
  await rm(base, { recursive: true, force: true });
});

describe('amulator MCP server', () => {
  it('lists exactly the documented tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('tells the caller to open the emulator when no tab is connected', async () => {
    const result = await call('emulator_tap', { x: 1, y: 1 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('emulator_open');
  });

  it('rejects out-of-range coordinates through the input schema', async () => {
    const result = await call('emulator_tap', { x: 400, y: 1 });
    expect(result.isError).toBe(true);
  });

  it('returns the page url without opening a browser when asked not to', async () => {
    const result = await call('emulator_open', { openBrowser: false });
    expect(result.isError).toBeFalsy();
    const url = textOf(result);
    expect(url.startsWith('http://127.0.0.1:')).toBe(true);
    expect(url).toContain('token=');
    expect(url).toContain('program=paint');
    page = await connectPage(url, {
      'tap': { ok: true },
      'drag': { ok: true },
      'screenshot': { pngBase64: 'iVBORw0KGgo=', width: 320, height: 480 },
      'snapshot.save': { imageHash: 'abc123', bytes: 42 },
      'snapshot.load': { restored: true },
      'pause': { ok: true },
      'resume': { ok: true },
    });
  });

  it('forwards tools to the connected page and shapes the results', async () => {
    expect(textOf(await call('emulator_tap', { x: 10, y: 20 }))).toBe('ok');
    expect(
      textOf(await call('emulator_drag', { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, steps: 8 })),
    ).toBe('ok');
    expect(textOf(await call('emulator_pause'))).toBe('ok');
    expect(textOf(await call('emulator_resume'))).toBe('ok');

    const shot = await call('emulator_screenshot');
    expect(shot.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      data: 'iVBORw0KGgo=',
    });

    const saved = textOf(await call('emulator_snapshot_save'));
    expect(saved).toContain('abc123');
    expect(saved).toContain('42');
    expect(textOf(await call('emulator_snapshot_load'))).toContain('true');
  });

  it('turns a malformed page result into an error result', async () => {
    page?.terminate();
    const open = await call('emulator_open', { openBrowser: false });
    page = await connectPage(textOf(open), { screenshot: { pngBase64: 7 } });
    const result = await call('emulator_screenshot');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unexpected response');
  });

  it('turns a page error response into an error result', async () => {
    page?.terminate();
    const open = await call('emulator_open', { openBrowser: false });
    page = await connectPage(textOf(open), {}, { code: -32000, message: 'guest is not running' });
    const result = await call('emulator_tap', { x: 1, y: 1 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('guest is not running');
  });
});
