import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { startBridgeServer } from './bridgeServer';
import { createAmulatorServer } from './tools';

const USAGE = 'Usage: amulator-mcp --data-dir <dir> [--web-root <dir>]';

const parseCli = (): { webRoot: string; dataDir: string } | undefined => {
  try {
    const { values } = parseArgs({
      options: { 'web-root': { type: 'string' }, 'data-dir': { type: 'string' } },
      strict: true,
    });
    const dataDir = values['data-dir'];
    if (!dataDir) return undefined;
    // Default: the plugin layout ships the bundle in server/ and the web build in web/.
    const webRoot =
      values['web-root'] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
    return { webRoot, dataDir };
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const cli = parseCli();
  if (!cli) {
    console.error(USAGE);
    process.exit(1);
  }
  const bridge = await startBridgeServer(cli);
  const stdio = serveStdio(() => createAmulatorServer(bridge));

  // The bridge listener would keep the process alive after Claude Code closes the pipe.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void Promise.all([stdio.close(), bridge.close()]).finally(() => process.exit(0));
  };
  // After a stdout write error the SDK transport drops its stdin listeners, so 'end' alone is not enough.
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  process.stdout.once('error', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
