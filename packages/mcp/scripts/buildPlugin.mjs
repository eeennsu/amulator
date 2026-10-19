import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const SERVER_DIR = path.join(PLUGIN_DIR, 'server');
const WEB_DIR = path.join(PLUGIN_DIR, 'web');

// The bundle is ESM, but dependencies such as ws call require().
const REQUIRE_BANNER =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

try {
  // A single command string: Windows needs a shell to run pnpm (a .cmd shim) and rejects shell + args.
  const web = spawnSync('pnpm --filter @amulator/web build', {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
  });
  if (web.status !== 0) throw new Error(`Web build failed (exit code ${web.status}).`);

  rmSync(SERVER_DIR, { recursive: true, force: true });
  await build({
    entryPoints: [path.join(ROOT, 'packages', 'mcp', 'src', 'server.ts')],
    outfile: path.join(SERVER_DIR, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: REQUIRE_BANNER },
    logLevel: 'warning',
  });

  rmSync(WEB_DIR, { recursive: true, force: true });
  cpSync(path.join(ROOT, 'apps', 'web', 'dist'), WEB_DIR, { recursive: true });
  process.stdout.write(`built ${PLUGIN_DIR}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
