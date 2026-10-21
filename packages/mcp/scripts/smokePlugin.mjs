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
  const html = await response.text();
  check(html.includes('id="root"'), 'the page has no id="root"');

  // The page is a React entry: its module script must be served as JavaScript by the same server.
  const src = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  check(src !== undefined, 'the page has no <script type="module" src>');
  const script = await fetch(new URL(src, first.text), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  check(script.status === 200, `GET ${src} returned ${script.status}`);
  const scriptType = script.headers.get('content-type') ?? '';
  check(scriptType.includes('javascript'), `${src} has content-type "${scriptType}"`);

  process.stdout.write('smoke ok\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
  await rm(dataDir, { recursive: true, force: true });
}
