import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { TOOL_NAMES } from '../src/tools';

const PLUGIN_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'plugin');
const FETCH_TIMEOUT_MS = 10_000;

const check = (condition, message) => {
  if (!condition) throw new Error(`smoke failed: ${message}`);
};

const dataDir = await mkdtemp(path.join(tmpdir(), 'amulator-smoke-'));
const client = new Client({ name: 'amulator-smoke', version: '0.0.0' });

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(PLUGIN_DIR, 'server', 'index.mjs'),
        '--web-root',
        path.join(PLUGIN_DIR, 'web'),
        '--data-dir',
        dataDir,
      ],
    }),
  );

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  const expected = [...TOOL_NAMES].sort();
  check(
    names.join() === expected.join(),
    `expected tools ${expected.join(', ')}, got ${names.join(', ')}`,
  );

  const opened = await client.callTool({
    name: 'emulator_open',
    arguments: { openBrowser: false },
  });
  const first = opened.content[0];
  check(!opened.isError && first?.type === 'text', 'emulator_open did not return text');
  const response = await fetch(first.text, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  check(response.status === 200, `GET ${first.text} returned ${response.status}`);
  check((await response.text()).includes('<canvas'), 'the page has no <canvas');

  process.stdout.write('smoke ok\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
  await rm(dataDir, { recursive: true, force: true });
}
