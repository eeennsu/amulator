import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CSR } from '../src/cpu/csr';
import {
  inspectCpu,
  memoryRegions,
  PEEK_MAX_BYTES,
  peekMemory,
  summarizeElf,
} from '../src/inspect';
import { createMachine } from '../src/machine';
import { FB_BASE, RAM_BASE, RAM_SIZE } from '../src/memoryMap';

const GUEST_OUT = resolve(import.meta.dirname, '../../../guest/baremetal/out');
const FIRST_BYTES = 16;
const WORD_BYTES = 4;
const GUEST_ENTRY = 0x8000_0000;

const load = () => {
  const machine = createMachine({ clock: { nowMicros: () => 0 }, onUartTransmit: () => undefined });
  const image = machine.loadElf(new Uint8Array(readFileSync(resolve(GUEST_OUT, 'paint.elf'))));
  return { machine, image };
};

describe('inspectCpu', () => {
  it('pc, 레지스터 32개, CSR 여섯 개를 돌려준다', () => {
    const { machine } = load();
    machine.cpu.writeCsr(CSR.mtvec, 0x8000_0100);
    const view = inspectCpu(machine.cpu);
    expect(view.pc).toBe(GUEST_ENTRY);
    expect(view.x).toHaveLength(32);
    expect(view.idle).toBe(false);
    expect(Object.keys(view.csr)).toEqual(['mstatus', 'mtvec', 'mepc', 'mcause', 'mie', 'mip']);
    expect(view.csr.mtvec).toBe(machine.cpu.readCsr(CSR.mtvec));
    expect(view.csr.mtvec).toBe(0x8000_0100);
  });

  it('돌려준 레지스터 배열을 바꿔도 CPU가 바뀌지 않는다', () => {
    const { machine } = load();
    inspectCpu(machine.cpu).x[5] = 1234;
    expect(machine.cpu.x[5]).toBe(0);
  });
});

describe('memoryRegions', () => {
  it('RAM과 장치 넷을 주소와 함께 돌려준다', () => {
    const { machine } = load();
    const regions = memoryRegions(machine);
    expect(regions.map((region) => region.name)).toEqual([
      'ram',
      'uart16550',
      'clint',
      'framebuffer',
      'touch',
    ]);
    expect(regions[0]).toEqual({ name: 'ram', base: RAM_BASE, size: RAM_SIZE });
    expect(regions.find((region) => region.name === 'framebuffer')?.base).toBe(FB_BASE);
  });
});

describe('peekMemory', () => {
  it('RAM을 복사해 돌려준다', () => {
    const { machine, image } = load();
    const segment = image.segments[0];
    if (segment === undefined) throw new Error('세그먼트가 없다');
    const peeked = peekMemory(machine, segment.paddr, FIRST_BYTES);
    expect(peeked).toEqual(segment.data.subarray(0, FIRST_BYTES));
    peeked.fill(0xee);
    expect(peekMemory(machine, segment.paddr, FIRST_BYTES)).toEqual(
      segment.data.subarray(0, FIRST_BYTES),
    );
  });

  it('프레임버퍼를 읽는다', () => {
    const { machine } = load();
    machine.framebuffer.write(0, WORD_BYTES, 0x00ab_cdef);
    expect(peekMemory(machine, FB_BASE, WORD_BYTES)).toEqual(Uint8Array.of(0xef, 0xcd, 0xab, 0));
  });

  it('장치 레지스터는 건드리지 않고 거부한다', () => {
    const { machine } = load();
    expect(() => peekMemory(machine, machine.uart.base, 1)).toThrow(RangeError);
  });

  it.each([
    ['RAM 끝을 넘는다', RAM_BASE + RAM_SIZE - 2, WORD_BYTES],
    ['어느 구간에도 없다', 0, WORD_BYTES],
    ['길이가 0이다', RAM_BASE, 0],
    ['너무 길다', RAM_BASE, PEEK_MAX_BYTES + 1],
  ])('요청이 %s면 RangeError다', (_name, address, length) => {
    const { machine } = load();
    expect(() => peekMemory(machine, address, length)).toThrow(RangeError);
  });
});

describe('summarizeElf', () => {
  it('진입 주소와 세그먼트 크기, 심볼을 담는다', () => {
    const { image } = load();
    const summary = summarizeElf(image);
    expect(summary.entry).toBe(GUEST_ENTRY);
    expect(summary.segments).toEqual(
      image.segments.map((segment) => ({
        paddr: segment.paddr,
        filesz: segment.data.length,
        memsz: segment.memsz,
      })),
    );
    expect(summary.symbols.some(([name]) => name === 'main')).toBe(true);
  });
});
