import { describe, expect, it } from 'vitest';

import { createFramebuffer } from '../src/devices/framebuffer';
import { FB_BASE, FB_HEIGHT, FB_STRIDE, FB_WIDTH } from '../src/memoryMap';

describe('프레임버퍼', () => {
  it('FB_BASE에서 FB_STRIDE * FB_HEIGHT 바이트를 차지한다', () => {
    const framebuffer = createFramebuffer();
    expect(framebuffer.name).toBe('framebuffer');
    expect(framebuffer.base).toBe(FB_BASE);
    expect(framebuffer.size).toBe(FB_STRIDE * FB_HEIGHT);
    expect(framebuffer.pixels.length).toBe(framebuffer.size);
    expect(framebuffer.dirty).toBe(false);
  });

  it('4바이트 쓰기는 dirty를 올리고 toRgba가 첫 픽셀을 R,G,B,255로 채운다', () => {
    const framebuffer = createFramebuffer();
    framebuffer.write(0, 4, 0x00ff_8040);
    expect(framebuffer.dirty).toBe(true);

    const rgba = new Uint8ClampedArray(FB_WIDTH * FB_HEIGHT * 4);
    framebuffer.toRgba(rgba);
    expect([...rgba.slice(0, 4)]).toEqual([0xff, 0x80, 0x40, 0xff]);
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 0, 0xff]);
  });

  it('1·2·4바이트를 리틀엔디언으로 pixels에 저장하고 같은 값으로 읽는다', () => {
    const framebuffer = createFramebuffer();
    framebuffer.write(4, 4, 0x1122_3344);
    expect([...framebuffer.pixels.slice(4, 8)]).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(framebuffer.read(4, 4)).toBe(0x1122_3344);
    expect(framebuffer.read(6, 2)).toBe(0x1122);
    framebuffer.write(5, 1, 0xaa);
    framebuffer.write(6, 2, 0xbbcc);
    expect([...framebuffer.pixels.slice(4, 8)]).toEqual([0x44, 0xaa, 0xcc, 0xbb]);
    expect(framebuffer.read(5, 1)).toBe(0xaa);
  });

  it('호스트가 dirty를 내리면 다음 쓰기 전까지 false다', () => {
    const framebuffer = createFramebuffer();
    framebuffer.write(0, 1, 1);
    framebuffer.dirty = false;
    expect(framebuffer.dirty).toBe(false);
    framebuffer.write(0, 1, 2);
    expect(framebuffer.dirty).toBe(true);
  });
});
