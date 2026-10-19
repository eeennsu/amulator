import { describe, expect, it } from 'vitest';

import { dragEvents, tapEvents } from '../src/control/gestures';

describe('제스처', () => {
  it('tap은 같은 점에서 누르고 뗀다', () => {
    expect(tapEvents({ x: 5, y: 6 })).toEqual([
      { x: 5, y: 6, down: true },
      { x: 5, y: 6, down: false },
    ]);
  });

  it('drag는 시작점에서 끝점까지 steps 구간으로 나눠 누른 채 움직이고 끝점에서 뗀다', () => {
    expect(dragEvents({ x: 0, y: 0 }, { x: 40, y: 0 }, 4)).toEqual([
      { x: 0, y: 0, down: true },
      { x: 10, y: 0, down: true },
      { x: 20, y: 0, down: true },
      { x: 30, y: 0, down: true },
      { x: 40, y: 0, down: true },
      { x: 40, y: 0, down: false },
    ]);
  });

  it('중간 점은 반올림하고 끝점에 정확히 도착한다', () => {
    const events = dragEvents({ x: 0, y: 10 }, { x: 5, y: 0 }, 3);
    expect(events.map(({ x, y }) => [x, y])).toEqual([
      [0, 10],
      [2, 7],
      [3, 3],
      [5, 0],
      [5, 0],
    ]);
    expect(events.at(-1)?.down).toBe(false);
  });
});
