import { describe, expect, it } from 'vitest';

import { FB_STRIDE, FB_WIDTH, RAM_BASE, UART_BASE } from '../src/memoryMap';

describe('memoryMap', () => {
  it('RAM은 0x8000_0000에서 시작한다', () => {
    expect(RAM_BASE).toBe(0x8000_0000);
  });

  it('프레임버퍼 stride는 픽셀당 4바이트다', () => {
    expect(FB_STRIDE).toBe(FB_WIDTH * 4);
  });

  it('UART는 0x1000_0000이다', () => {
    expect(UART_BASE).toBe(0x1000_0000);
  });
});
