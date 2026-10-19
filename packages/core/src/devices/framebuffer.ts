import type { AccessWidth, Device } from '../bus';
import { FB_BASE, FB_HEIGHT, FB_STRIDE } from '../memoryMap';

export type Framebuffer = Device & {
  readonly pixels: Uint8Array; // FB_STRIDE * FB_HEIGHT 바이트, XRGB8888 LE
  dirty: boolean; // 쓰기가 있으면 true, 호스트가 그린 뒤 false로 돌린다
  toRgba: (target: Uint8ClampedArray) => void; // R,G,B,255 순서로 채운다
};

const PIXEL_BYTES = 4;
const BYTE_MASK = 0xff;
const OPAQUE = 0xff;

// 메모리이므로 정렬된 1·2·4바이트 접근을 모두 받는다.
export const createFramebuffer = (): Framebuffer => {
  const pixels = new Uint8Array(FB_STRIDE * FB_HEIGHT);
  const view = new DataView(pixels.buffer);

  const read = (offset: number, width: AccessWidth): number => {
    if (width === 1) return view.getUint8(offset);
    if (width === 2) return view.getUint16(offset, true);
    return view.getUint32(offset, true);
  };

  const write = (offset: number, width: AccessWidth, value: number): void => {
    if (width === 1) view.setUint8(offset, value);
    else if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    framebuffer.dirty = true;
  };

  const toRgba = (target: Uint8ClampedArray): void => {
    for (let offset = 0; offset < pixels.length; offset += PIXEL_BYTES) {
      const xrgb = view.getUint32(offset, true);
      target[offset] = (xrgb >>> 16) & BYTE_MASK;
      target[offset + 1] = (xrgb >>> 8) & BYTE_MASK;
      target[offset + 2] = xrgb & BYTE_MASK;
      target[offset + 3] = OPAQUE;
    }
  };

  const framebuffer: Framebuffer = {
    name: 'framebuffer',
    base: FB_BASE,
    size: pixels.length,
    pixels,
    dirty: false,
    read,
    write,
    toRgba,
  };
  return framebuffer;
};
