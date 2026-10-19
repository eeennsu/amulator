import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createMachine } from '../src/machine';
import { FB_STRIDE } from '../src/memoryMap';

const GUEST_OUT = resolve(import.meta.dirname, '../../../guest/baremetal/out');
const WHITE = 0x00ff_ffff;
const BLACK = 0x0000_0000;
const READY = 'paint ready\n';
const BOOT_CHUNK = 100_000;
const BOOT_CHUNKS_MAX = 20;
const DRAW_BUDGET = 500_000;

// 화면을 다 칠하고 READY를 내기까지 청크 단위로 돌린다.
const boot = () => {
  const state = { output: '' };
  const machine = createMachine({
    clock: { nowMicros: () => 0 },
    onUartTransmit: (byte) => {
      state.output += String.fromCharCode(byte);
    },
  });
  machine.loadElf(new Uint8Array(readFileSync(resolve(GUEST_OUT, 'paint.elf'))));
  for (let chunk = 0; chunk < BOOT_CHUNKS_MAX && state.output !== READY; chunk += 1) {
    machine.run(BOOT_CHUNK);
  }
  const pixel = (x: number, y: number): number => {
    const offset = y * FB_STRIDE + x * 4;
    return machine.framebuffer.read(offset, 4);
  };
  return { state, machine, pixel };
};

describe('paint.elf', () => {
  it('화면을 흰색으로 채우고 준비 문구를 낸다', () => {
    const { state, pixel } = boot();
    expect(state.output).toBe(READY);
    expect(pixel(100, 100)).toBe(WHITE);
    expect(pixel(0, 0)).toBe(WHITE);
    expect(pixel(319, 479)).toBe(WHITE);
  });

  it('누른 채 움직이면 두 점 사이를 검정으로 잇는다', () => {
    const { machine, pixel } = boot();
    machine.touch.push({ x: 10, y: 10, down: true });
    machine.touch.push({ x: 20, y: 10, down: true });
    machine.touch.push({ x: 20, y: 10, down: false });
    machine.run(DRAW_BUDGET);
    for (let x = 10; x <= 20; x += 1) expect(pixel(x, 10)).toBe(BLACK);
    expect(machine.touch.queueLength).toBe(0);
  });

  it('탭은 점 하나만 찍는다', () => {
    const { machine, pixel } = boot();
    machine.touch.push({ x: 50, y: 50, down: true });
    machine.touch.push({ x: 50, y: 50, down: false });
    machine.run(DRAW_BUDGET);
    expect(pixel(50, 50)).toBe(BLACK);
    expect(pixel(60, 50)).toBe(WHITE);
  });

  it('손을 뗀 뒤 다시 누르면 이전 점과 잇지 않는다', () => {
    const { machine, pixel } = boot();
    machine.touch.push({ x: 10, y: 100, down: true });
    machine.touch.push({ x: 10, y: 100, down: false });
    machine.touch.push({ x: 40, y: 100, down: true });
    machine.run(DRAW_BUDGET);
    expect(pixel(10, 100)).toBe(BLACK);
    expect(pixel(40, 100)).toBe(BLACK);
    expect(pixel(25, 100)).toBe(WHITE);
  });

  it('가파른 대각선도 끊김 없이 잇는다', () => {
    const { machine, pixel } = boot();
    machine.touch.push({ x: 100, y: 100, down: true });
    machine.touch.push({ x: 90, y: 120, down: true });
    machine.run(DRAW_BUDGET);
    expect(pixel(100, 100)).toBe(BLACK);
    expect(pixel(95, 110)).toBe(BLACK);
    expect(pixel(90, 120)).toBe(BLACK);
    expect(pixel(110, 110)).toBe(WHITE);
  });

  it('화면 모서리의 붓은 화면 밖에 쓰지 않는다', () => {
    const { machine, pixel } = boot();
    machine.touch.push({ x: 0, y: 0, down: true });
    machine.touch.push({ x: 319, y: 479, down: true });
    const result = machine.run(DRAW_BUDGET);
    // 화면 밖 쓰기는 접근 오류 트랩이 되어 게스트가 wfi에서 멈춘다.
    expect(result.idle).toBe(false);
    expect(pixel(0, 0)).toBe(BLACK);
    expect(pixel(1, 1)).toBe(BLACK);
    expect(pixel(319, 479)).toBe(BLACK);
  });
});
