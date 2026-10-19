import { z } from 'zod';

import { FB_HEIGHT, FB_WIDTH } from '../memoryMap';

// 단독 서버(Task 13)와 worker가 같은 이름을 쓰도록 여기에 둔다.
export const SNAPSHOT_TOKEN_HEADER = 'X-Amulator-Token';

export const BRIDGE_ERROR_CODE = { invalidRequest: -32600, internal: -32000 } as const;

const DRAG_STEPS_DEFAULT = 16;
const DRAG_STEPS_MAX = 100;

const X_MAX = FB_WIDTH - 1;
const Y_MAX = FB_HEIGHT - 1;

export const pointSchema = z.object({
  x: z.int().min(0).max(X_MAX),
  y: z.int().min(0).max(Y_MAX),
});

export type Point = z.infer<typeof pointSchema>;

const header = { jsonrpc: z.literal('2.0'), id: z.int() };
const noParams = z.object({});

export const bridgeRequestSchema = z.discriminatedUnion('method', [
  z.object({ ...header, method: z.literal('tap'), params: pointSchema }),
  z.object({
    ...header,
    method: z.literal('drag'),
    params: z.object({
      from: pointSchema,
      to: pointSchema,
      steps: z.int().min(1).max(DRAG_STEPS_MAX).default(DRAG_STEPS_DEFAULT),
    }),
  }),
  z.object({ ...header, method: z.literal('screenshot'), params: noParams }),
  z.object({ ...header, method: z.literal('snapshot.save'), params: noParams }),
  z.object({ ...header, method: z.literal('snapshot.load'), params: noParams }),
  z.object({ ...header, method: z.literal('pause'), params: noParams }),
  z.object({ ...header, method: z.literal('resume'), params: noParams }),
]);

export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;

// 요청을 읽지 못해 id를 알 수 없는 오류 응답은 JSON-RPC대로 id가 null이다.
export const bridgeResponseSchema = z.union([
  z.object({
    jsonrpc: z.literal('2.0'),
    id: z.int().nullable(),
    error: z.object({ code: z.int(), message: z.string() }),
  }),
  z
    .object({ jsonrpc: z.literal('2.0'), id: z.int(), result: z.unknown() })
    .refine((response) => 'result' in response, 'result가 없다'),
]);

export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;

export const screenshotResultSchema = z.object({
  pngBase64: z.string(),
  width: z.int(),
  height: z.int(),
});
export const snapshotSaveResultSchema = z.object({ imageHash: z.string(), bytes: z.int() });
export const snapshotLoadResultSchema = z.object({ restored: z.boolean() });
export const okResultSchema = z.object({ ok: z.literal(true) });

const invalidRequest = (id: number | null, message: string): BridgeResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code: BRIDGE_ERROR_CODE.invalidRequest, message },
});

const idSchema = z.object({ id: z.int() });

// 바깥에서 온 텍스트를 검증한다. 거부한 요청은 id를 알면 그 id로 오류 응답을 만든다.
export const parseBridgeRequest = (
  text: string,
): { request: BridgeRequest } | { response: BridgeResponse } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { response: invalidRequest(null, 'JSON이 아니다') };
  }
  const parsed = bridgeRequestSchema.safeParse(raw);
  if (parsed.success) return { request: parsed.data };
  const id = idSchema.safeParse(raw);
  return {
    response: invalidRequest(id.success ? id.data.id : null, z.prettifyError(parsed.error)),
  };
};
