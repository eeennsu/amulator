import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';

export type ClientRect = { left: number; top: number; width: number; height: number };

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

// canvas의 화면상 크기와 무관하게 0..FB_WIDTH-1, 0..FB_HEIGHT-1 정수 좌표로 바꾼다.
export const toFramebufferPoint = (
  clientX: number,
  clientY: number,
  rect: ClientRect,
): { x: number; y: number } => ({
  x: clamp(Math.floor(((clientX - rect.left) / rect.width) * FB_WIDTH), FB_WIDTH - 1),
  y: clamp(Math.floor(((clientY - rect.top) / rect.height) * FB_HEIGHT), FB_HEIGHT - 1),
});
