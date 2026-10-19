import { describe, expect, it } from 'vitest';

import {
  BRIDGE_ERROR_CODE,
  bridgeRequestSchema,
  bridgeResponseSchema,
  okResultSchema,
  parseBridgeRequest,
  screenshotResultSchema,
  snapshotLoadResultSchema,
  snapshotSaveResultSchema,
} from '../src/control/protocol';

const tap = (x: number, y: number) => ({ jsonrpc: '2.0', id: 1, method: 'tap', params: { x, y } });

describe('브리지 요청 스키마', () => {
  it('화면 모서리 좌표의 tap을 통과시킨다', () => {
    expect(bridgeRequestSchema.safeParse(tap(0, 479)).success).toBe(true);
    expect(bridgeRequestSchema.safeParse(tap(319, 0)).success).toBe(true);
  });

  it.each([
    ['x가 음수', tap(-1, 0)],
    ['x가 화면 너비', tap(320, 0)],
    ['x가 소수', tap(1.5, 0)],
    ['y가 화면 높이', tap(0, 480)],
  ])('범위를 벗어나거나 정수가 아닌 좌표를 거부한다: %s', (_name, request) => {
    expect(bridgeRequestSchema.safeParse(request).success).toBe(false);
  });

  it('알 수 없는 method를 거부한다', () => {
    const request = { jsonrpc: '2.0', id: 1, method: 'shell', params: { cmd: 'ls' } };
    expect(bridgeRequestSchema.safeParse(request).success).toBe(false);
  });

  it('drag에서 steps를 빼면 16이 되고, 범위 밖 steps는 거부한다', () => {
    const drag = (params: object) => ({ jsonrpc: '2.0', id: 2, method: 'drag', params });
    const ends = { from: { x: 0, y: 0 }, to: { x: 40, y: 0 } };
    expect(bridgeRequestSchema.parse(drag(ends))).toMatchObject({ params: { steps: 16 } });
    expect(bridgeRequestSchema.safeParse(drag({ ...ends, steps: 100 })).success).toBe(true);
    expect(bridgeRequestSchema.safeParse(drag({ ...ends, steps: 0 })).success).toBe(false);
    expect(bridgeRequestSchema.safeParse(drag({ ...ends, steps: 101 })).success).toBe(false);
  });

  it.each(['screenshot', 'snapshot.save', 'snapshot.load', 'pause', 'resume'])(
    '빈 params의 %s를 통과시킨다',
    (method) => {
      const request = { jsonrpc: '2.0', id: 3, method, params: {} };
      expect(bridgeRequestSchema.safeParse(request).success).toBe(true);
    },
  );
});

describe('브리지 응답 스키마', () => {
  it('error 응답을 error 필드를 지킨 채 통과시킨다', () => {
    const response = { jsonrpc: '2.0', id: 4, error: { code: -32000, message: '실패' } };
    expect(bridgeResponseSchema.parse(response)).toEqual(response);
  });

  it('result 응답을 통과시키고, result도 error도 없는 응답은 거부한다', () => {
    const response = { jsonrpc: '2.0', id: 4, result: { ok: true } };
    expect(bridgeResponseSchema.parse(response)).toEqual(response);
    expect(bridgeResponseSchema.safeParse({ jsonrpc: '2.0', id: 4 }).success).toBe(false);
  });

  it('method별 result 스키마가 각자의 모양만 받는다', () => {
    expect(okResultSchema.safeParse({ ok: true }).success).toBe(true);
    expect(okResultSchema.safeParse({ ok: false }).success).toBe(false);
    expect(snapshotLoadResultSchema.safeParse({ restored: false }).success).toBe(true);
    expect(snapshotSaveResultSchema.safeParse({ imageHash: 'ab', bytes: 10 }).success).toBe(true);
    expect(snapshotSaveResultSchema.safeParse({ imageHash: 'ab' }).success).toBe(false);
    const screenshot = { pngBase64: 'AA==', width: 320, height: 480 };
    expect(screenshotResultSchema.safeParse(screenshot).success).toBe(true);
    expect(screenshotResultSchema.safeParse({ pngBase64: 'AA==', width: 320 }).success).toBe(false);
  });
});

describe('parseBridgeRequest', () => {
  it('올바른 JSON 텍스트를 요청으로 돌려준다', () => {
    expect(parseBridgeRequest(JSON.stringify(tap(5, 6)))).toEqual({ request: tap(5, 6) });
  });

  it('스키마를 어긴 요청은 그 id를 담은 -32600 응답으로 돌려준다', () => {
    const parsed = parseBridgeRequest(JSON.stringify({ ...tap(320, 0), id: 7 }));
    expect(parsed).toMatchObject({
      response: { jsonrpc: '2.0', id: 7, error: { code: BRIDGE_ERROR_CODE.invalidRequest } },
    });
  });

  it('JSON이 아니거나 id를 알 수 없으면 id가 null인 -32600 응답이다', () => {
    const invalid = { response: { id: null, error: { code: -32600 } } };
    expect(parseBridgeRequest('not json')).toMatchObject(invalid);
    expect(parseBridgeRequest(JSON.stringify({ method: 'tap' }))).toMatchObject(invalid);
  });
});
