import type { TouchSample } from '../devices/touch';
import type { Point } from './protocol';

export const tapEvents = (p: Point): TouchSample[] => [
  { ...p, down: true },
  { ...p, down: false },
];

// 시작점에서 끝점까지 steps 구간으로 나눠 누른 채 움직이고 끝점에서 뗀다.
export const dragEvents = (from: Point, to: Point, steps: number): TouchSample[] => {
  const lerp = (a: number, b: number, step: number): number =>
    Math.round(a + ((b - a) * step) / steps);
  const moves = Array.from({ length: steps + 1 }, (_, step) => ({
    x: lerp(from.x, to.x, step),
    y: lerp(from.y, to.y, step),
    down: true,
  }));
  return [...moves, { ...to, down: false }];
};
