import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const STARTUP_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 4_000;
const TEST_TIMEOUT_MS = 10_000;

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shutdown-test', version: '0.0.0' },
  },
};
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };
const LIST_TOOLS = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

let base: string;
let child: ChildProcessWithoutNullStreams;
let exited: Promise<number | null>;

const send = (message: object): void => {
  child.stdin.write(`${JSON.stringify(message)}\n`);
};

// Resolves once the server has answered the initialize request, i.e. it finished starting up.
const waitForInitializeReply = (): Promise<void> =>
  new Promise((resolve, reject) => {
    let buffered = '';
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString('utf8');
      if (!buffered.includes('\n')) return;
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
    send(INITIALIZE);
  });

const exitWithin = (ms: number): Promise<number | null | 'timeout'> =>
  Promise.race([
    exited,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ]);

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'amulator-shutdown-'));
  child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/server.ts',
      '--web-root',
      path.join(base, 'web'),
      '--data-dir',
      path.join(base, 'data'),
    ],
    { cwd: PACKAGE_DIR, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  await waitForInitializeReply();
  send(INITIALIZED);
}, STARTUP_TIMEOUT_MS);

afterEach(async () => {
  child.kill();
  await exited;
  await rm(base, { recursive: true, force: true });
});

describe('server shutdown', () => {
  it(
    'exits with code 0 when the client closes stdin',
    async () => {
      child.stdin.end();

      expect(await exitWithin(EXIT_TIMEOUT_MS)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // The SDK transport stops listening to stdin after a stdout write error, so 'end' never fires.
  it(
    'exits when the client stops reading stdout and then goes away',
    async () => {
      child.stdout.destroy();
      send(LIST_TOOLS);
      child.stdin.end();

      expect(await exitWithin(EXIT_TIMEOUT_MS)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
