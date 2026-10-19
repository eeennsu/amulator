import { describe, expect, it } from 'vitest';

import { toFramebufferPoint } from '../src/pointer';

const RECT = { left: 0, top: 0, width: 640, height: 960 };

describe('toFramebufferPoint', () => {
  it('화면 배율에 맞춰 프레임버퍼 좌표로 바꾼다', () => {
    expect(toFramebufferPoint(320, 480, RECT)).toEqual({ x: 160, y: 240 });
  });

  it('canvas 왼쪽 위 밖은 0으로 자른다', () => {
    expect(toFramebufferPoint(-10, -10, RECT)).toEqual({ x: 0, y: 0 });
  });

  it('canvas 오른쪽 아래 밖은 마지막 픽셀로 자른다', () => {
    expect(toFramebufferPoint(700, 1000, RECT)).toEqual({ x: 319, y: 479 });
  });

  it('canvas의 위치 오프셋을 뺀다', () => {
    expect(toFramebufferPoint(120, 70, { left: 100, top: 50, width: 320, height: 480 })).toEqual({
      x: 20,
      y: 20,
    });
  });
});
