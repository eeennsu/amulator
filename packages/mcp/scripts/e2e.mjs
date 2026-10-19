// End-to-end check: drives the bundled plugin server over MCP while a real browser tab runs the
// emulator. Another process (a person or agent-browser) opens the printed URL, reloads the tab
// on RELOAD NOW and covers it with another tab on BACKGROUND NOW. Outputs go to out/e2e/.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const OUT_DIR = path.join(ROOT, 'out', 'e2e');
const SNAPSHOT_DIR = path.join(OUT_DIR, 'snapshots');
const SNAPSHOT_SUFFIX = '.amus.gz';

const RETRY_INTERVAL_MS = 1_000;
const WAIT_CAP_MS = 120_000;
const SETTLE_MS = 1_000;
const BACKGROUND_WAIT_MS = 20_000;

const DRAG = { from: { x: 40, y: 100 }, to: { x: 280, y: 100 }, steps: 24 };
const TAP = { x: 160, y: 300 };
// Drawn after the snapshot is saved, so a screen restored from the snapshot cannot show it.
const SENTINEL_TAP = { x: 300, y: 20 };

const log = (message) => process.stdout.write(`${new Date().toISOString()} ${message}\n`);

const check = (condition, message) => {
  if (!condition) throw new Error(`e2e failed: ${message}`);
};

const client = new Client({ name: 'amulator-e2e', version: '0.0.0' });
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const textOf = (result) =>
  result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ');

// Calls attempt until it returns something other than undefined.
const retry = async (label, attempt) => {
  const deadline = Date.now() + WAIT_CAP_MS;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    check(Date.now() < deadline, `${label} did not succeed within ${WAIT_CAP_MS / 1000} s`);
    await sleep(RETRY_INTERVAL_MS);
  }
};

// Returns the PNG bytes, or undefined while the screenshot fails or is rejected by accept.
const tryScreenshot = async (accept = () => true) => {
  const result = await call('emulator_screenshot');
  const image = result.content.find((block) => block.type === 'image');
  if (result.isError || !image) {
    log(`screenshot not ready: ${textOf(result)}`);
    return undefined;
  }
  const png = Buffer.from(image.data, 'base64');
  return accept(png) ? png : undefined;
};

const screenshotTo = async (label, file, accept) => {
  const png = await retry(label, () => tryScreenshot(accept));
  await writeFile(path.join(OUT_DIR, file), png);
  log(`${label}: saved out/e2e/${file} (${png.length} bytes)`);
  return png;
};

const timed = async (action) => {
  const start = performance.now();
  try {
    return { ok: true, value: await action(), ms: Math.round(performance.now() - start) };
  } catch (error) {
    return { ok: false, error, ms: Math.round(performance.now() - start) };
  }
};

// Informational: a covered tab may be throttled, so failures are reported, never thrown.
const backgroundCheck = async () => {
  log('BACKGROUND NOW');
  log(`waiting ${BACKGROUND_WAIT_MS / 1000} s`);
  await sleep(BACKGROUND_WAIT_MS);
  const total = performance.now();
  const tap = await timed(async () => {
    const result = await call('emulator_tap', TAP);
    check(!result.isError, `tap failed: ${textOf(result)}`);
  });
  log(`background tap: ${tap.ok ? 'ok' : `FAILED (${tap.error.message})`} in ${tap.ms} ms`);
  const shot = await timed(async () => {
    const result = await call('emulator_screenshot');
    const image = result.content.find((block) => block.type === 'image');
    check(!result.isError && image, `screenshot failed: ${textOf(result)}`);
    await writeFile(path.join(OUT_DIR, 'background.png'), Buffer.from(image.data, 'base64'));
  });
  log(
    `background screenshot: ${shot.ok ? 'ok' : `FAILED (${shot.error.message})`} in ${shot.ms} ms`,
  );
  log(`background tap + screenshot: ${Math.round(performance.now() - total)} ms in total`);
};

try {
  await rm(SNAPSHOT_DIR, { recursive: true, force: true });
  await mkdir(SNAPSHOT_DIR, { recursive: true });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(PLUGIN_DIR, 'server', 'index.mjs'),
        '--web-root',
        path.join(PLUGIN_DIR, 'web'),
        '--data-dir',
        SNAPSHOT_DIR,
      ],
    }),
  );

  const opened = await call('emulator_open', { openBrowser: false });
  check(!opened.isError, `emulator_open failed: ${textOf(opened)}`);
  log(`OPEN THIS URL: ${textOf(opened)}`);

  await retry('first screenshot', tryScreenshot);
  log('guest is up');

  const drag = await call('emulator_drag', DRAG);
  check(!drag.isError, `emulator_drag failed: ${textOf(drag)}`);
  await sleep(SETTLE_MS);
  const afterDrag = await screenshotTo('after drag', 'after-drag.png');

  const saved = await call('emulator_snapshot_save');
  check(!saved.isError, `emulator_snapshot_save failed: ${textOf(saved)}`);
  log(textOf(saved));
  const files = (await readdir(SNAPSHOT_DIR)).filter((name) => name.endsWith(SNAPSHOT_SUFFIX));
  check(files.length === 1, `expected one ${SNAPSHOT_SUFFIX} file, found ${files.length}`);
  log(`snapshot file: ${files[0]}`);

  const sentinelTap = await call('emulator_tap', SENTINEL_TAP);
  check(!sentinelTap.isError, `sentinel tap failed: ${textOf(sentinelTap)}`);
  await sleep(SETTLE_MS);
  const sentinel = await screenshotTo('sentinel', 'sentinel.png');
  check(!sentinel.equals(afterDrag), 'the sentinel tap did not change the screen');

  // The old tab keeps answering with the sentinel screen; only the reloaded tab can differ from it.
  log('RELOAD NOW');
  const afterReload = await screenshotTo(
    'after reload',
    'after-reload.png',
    (png) => !png.equals(sentinel),
  );
  check(
    afterReload.equals(afterDrag),
    'the reloaded screen differs from the saved one: the disk snapshot was not restored',
  );

  await backgroundCheck();

  log('e2e ok');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
}
