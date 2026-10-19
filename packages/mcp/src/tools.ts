import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  DRAG_STEPS_MAX,
  okResultSchema,
  pointSchema,
  PROGRAM_NAMES,
  screenshotResultSchema,
  snapshotLoadResultSchema,
  snapshotSaveResultSchema,
  type BridgeRequest,
} from '@amulator/core/control/protocol';
import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';
import { EMULATOR_VERSION } from '@amulator/core/version';

import {
  BridgeDisconnectedError,
  BridgePageError,
  BridgeTimeoutError,
  type BridgeServer,
} from './bridgeServer';
import { openBrowser } from './openBrowser';

export const TOOL_NAMES = [
  'emulator_open',
  'emulator_tap',
  'emulator_drag',
  'emulator_screenshot',
  'emulator_snapshot_save',
  'emulator_snapshot_load',
  'emulator_pause',
  'emulator_resume',
] as const;

const SERVER_INFO = { name: 'amulator', version: EMULATOR_VERSION };
const DEFAULT_PROGRAM = 'paint';

const SCREEN = `${FB_WIDTH}x${FB_HEIGHT}`;
const POINT_HELP = `Pixel coordinates on the ${SCREEN} screen; the origin is the top-left corner.`;

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });
const failure = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const isBridgeError = (error: unknown): error is Error =>
  error instanceof BridgeTimeoutError ||
  error instanceof BridgeDisconnectedError ||
  error instanceof BridgePageError;

export const createAmulatorServer = (
  bridge: BridgeServer,
  // Tests pass a stub so they can observe whether a browser would have been opened.
  { openBrowser: open = openBrowser }: { openBrowser?: (url: string) => void } = {},
): McpServer => {
  const server = new McpServer(SERVER_INFO);

  // Sends one bridge request and renders its validated result; bridge failures become error results.
  const forward = async <Schema extends z.ZodType>(
    method: BridgeRequest['method'],
    params: object,
    schema: Schema,
    render: (result: z.output<Schema>) => CallToolResult,
  ): Promise<CallToolResult> => {
    try {
      const parsed = schema.safeParse(await bridge.request(method, params));
      if (!parsed.success) {
        return failure(
          `Unexpected response from the emulator page: ${z.prettifyError(parsed.error)}`,
        );
      }
      return render(parsed.data);
    } catch (error) {
      if (isBridgeError(error)) return failure(error.message);
      throw error;
    }
  };

  const ok = (): CallToolResult => text('ok');

  server.registerTool(
    'emulator_open',
    {
      description:
        "Return this session's emulator page URL and, when no tab is connected yet, open it in " +
        'the default browser. The URL carries a private session token; the page connects back to ' +
        'this server over a local WebSocket. If a tab is already connected, no new window is ' +
        'opened and that tab keeps running its current program. Call this first: the other ' +
        'emulator tools wait a few seconds for the page to connect, then fail.',
      inputSchema: z.object({
        program: z
          .enum(PROGRAM_NAMES)
          .default(DEFAULT_PROGRAM)
          .describe('Guest program to run: hello (text), clock (text), or paint (touch drawing).'),
        openBrowser: z
          .boolean()
          .default(true)
          .describe('Open the URL in the default browser. Pass false to open it yourself.'),
      }),
    },
    ({ program, openBrowser: shouldOpen }) => {
      const url = bridge.pageUrl(program);
      // Another window would replace the connected tab (the newest connection wins).
      if (bridge.isConnected()) return text(`Already connected: ${url}`);
      if (shouldOpen) open(url);
      return text(url);
    },
  );

  server.registerTool(
    'emulator_tap',
    {
      description: `Tap the touch screen once. ${POINT_HELP}`,
      inputSchema: pointSchema,
    },
    (point) => forward('tap', point, okResultSchema, ok),
  );

  server.registerTool(
    'emulator_drag',
    {
      description: `Drag a finger from one point to another in a straight line. ${POINT_HELP}`,
      inputSchema: z.object({
        from: pointSchema,
        to: pointSchema,
        steps: z
          .int()
          .min(1)
          .max(DRAG_STEPS_MAX)
          .optional()
          .describe('Number of intermediate touch samples. Defaults to 16.'),
      }),
    },
    (drag) => forward('drag', drag, okResultSchema, ok),
  );

  server.registerTool(
    'emulator_screenshot',
    {
      description: `Capture the current ${SCREEN} screen as a PNG image. Waits for the guest to boot.`,
    },
    () =>
      forward('screenshot', {}, screenshotResultSchema, ({ pngBase64 }) => ({
        content: [{ type: 'image', data: pngBase64, mimeType: 'image/png' }],
      })),
  );

  server.registerTool(
    'emulator_snapshot_save',
    {
      description:
        'Save the full machine state to disk on this computer. Returns the image hash that keys ' +
        'the snapshot and its size in bytes.',
    },
    () =>
      forward('snapshot.save', {}, snapshotSaveResultSchema, ({ imageHash, bytes }) =>
        text(`Snapshot saved. imageHash: ${imageHash}, bytes: ${bytes}`),
      ),
  );

  server.registerTool(
    'emulator_snapshot_load',
    {
      description:
        'Restore the machine state saved by emulator_snapshot_save for the running program. ' +
        'Reports restored: false when no usable snapshot exists.',
    },
    () =>
      forward('snapshot.load', {}, snapshotLoadResultSchema, ({ restored }) =>
        text(`restored: ${restored}`),
      ),
  );

  server.registerTool(
    'emulator_pause',
    { description: 'Pause the guest. Its state is kept until emulator_resume.' },
    () => forward('pause', {}, okResultSchema, ok),
  );

  server.registerTool(
    'emulator_resume',
    { description: 'Resume a guest paused by emulator_pause.' },
    () => forward('resume', {}, okResultSchema, ok),
  );

  return server;
};
