import type { Cpu } from './cpu/cpu';
import { CSR, type Privilege } from './cpu/csr';
import type { ElfImage } from './elf';
import type { Machine } from './machine';
import { FB_BASE, RAM_BASE } from './memoryMap';

export const INSPECTED_CSRS = ['mstatus', 'mtvec', 'mepc', 'mcause', 'mie', 'mip'] as const;
export type InspectedCsr = (typeof INSPECTED_CSRS)[number];

export type CpuView = {
  pc: number;
  x: number[];
  privilege: Privilege;
  idle: boolean;
  csr: Record<InspectedCsr, number>;
};

export const inspectCpu = (cpu: Cpu): CpuView => ({
  pc: cpu.pc,
  x: Array.from(cpu.x),
  privilege: cpu.privilege,
  idle: cpu.idle,
  csr: {
    mstatus: cpu.readCsr(CSR.mstatus),
    mtvec: cpu.readCsr(CSR.mtvec),
    mepc: cpu.readCsr(CSR.mepc),
    mcause: cpu.readCsr(CSR.mcause),
    mie: cpu.readCsr(CSR.mie),
    mip: cpu.readCsr(CSR.mip),
  },
});

export type MemoryRegion = { name: string; base: number; size: number };

export const memoryRegions = (machine: Machine): MemoryRegion[] => [
  { name: 'ram', base: RAM_BASE, size: machine.ram.length },
  ...[machine.uart, machine.clint, machine.framebuffer, machine.touch].map(
    ({ name, base, size }) => ({ name, base, size }),
  ),
];

export const PEEK_MAX_BYTES = 4096;

// 버스를 거치면 장치 읽기의 부작용(UART FIFO 소비 등)이 생기므로 RAM과 프레임버퍼 배열에서 바로 복사한다.
export const peekMemory = (machine: Machine, address: number, length: number): Uint8Array => {
  if (!Number.isInteger(length) || length < 1 || length > PEEK_MAX_BYTES) {
    throw new RangeError(`엿볼 길이는 1~${PEEK_MAX_BYTES}바이트여야 한다: ${length}`);
  }
  for (const [base, bytes] of [
    [RAM_BASE, machine.ram],
    [FB_BASE, machine.framebuffer.pixels],
  ] as const) {
    const offset = address - base;
    if (Number.isInteger(offset) && offset >= 0 && offset + length <= bytes.length) {
      return bytes.slice(offset, offset + length);
    }
  }
  throw new RangeError(`RAM이나 프레임버퍼 안의 구간이 아니다: 0x${address.toString(16)}`);
};

export type ElfSummary = {
  entry: number;
  segments: { paddr: number; filesz: number; memsz: number }[];
  symbols: [string, number][];
};

export const summarizeElf = (image: ElfImage): ElfSummary => ({
  entry: image.entry,
  segments: image.segments.map(({ paddr, data, memsz }) => ({
    paddr,
    filesz: data.length,
    memsz,
  })),
  symbols: Array.from(image.symbols),
});
