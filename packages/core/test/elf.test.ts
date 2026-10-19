import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { ElfError, loadElfIntoRam, parseElf32, type ElfImage } from '../src/elf';
import { RAM_BASE } from '../src/memoryMap';

const HELLO_ELF = resolve(import.meta.dirname, '../../../guest/baremetal/out/hello.elf');
const RAM_BYTES = 0x1_0000;

const E_MACHINE_OFFSET = 18;
const EHDR_SIZE = 52;
const PHDR_SIZE = 32;
const PT_LOAD = 1;
const EM_RISCV = 243;

type SyntheticSegment = { paddr: number; data: number[]; memsz: number };

// 섹션 헤더가 없는 ELF32 하나를 만든다. PT_LOAD 한 개만 담는다.
const buildElf = ({ paddr, data, memsz }: SyntheticSegment): Uint8Array => {
  const dataOffset = EHDR_SIZE + PHDR_SIZE;
  const bytes = new Uint8Array(dataOffset + data.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);
  view.setUint16(16, 2, true); // e_type: ET_EXEC
  view.setUint16(E_MACHINE_OFFSET, EM_RISCV, true);
  view.setUint32(20, 1, true); // e_version
  view.setUint32(24, paddr, true); // e_entry
  view.setUint32(28, EHDR_SIZE, true); // e_phoff
  view.setUint16(40, EHDR_SIZE, true); // e_ehsize
  view.setUint16(42, PHDR_SIZE, true); // e_phentsize
  view.setUint16(44, 1, true); // e_phnum
  view.setUint32(EHDR_SIZE, PT_LOAD, true);
  view.setUint32(EHDR_SIZE + 4, dataOffset, true); // p_offset
  view.setUint32(EHDR_SIZE + 8, paddr, true); // p_vaddr
  view.setUint32(EHDR_SIZE + 12, paddr, true); // p_paddr
  view.setUint32(EHDR_SIZE + 16, data.length, true); // p_filesz
  view.setUint32(EHDR_SIZE + 20, memsz, true); // p_memsz
  bytes.set(data, dataOffset);
  return bytes;
};

describe('parseElf32', () => {
  let hello: Uint8Array;

  beforeAll(() => {
    hello = new Uint8Array(readFileSync(HELLO_ELF));
  });

  it('hello.elf의 entry와 _start 심볼을 읽는다', () => {
    const image = parseElf32(hello);
    expect(image.entry).toBe(0x8000_0000);
    expect(image.symbols.get('_start')).toBe(0x8000_0000);
  });

  it('첫 바이트가 틀리면 ElfError다', () => {
    const broken = hello.slice();
    broken[0] = 0;
    expect(() => parseElf32(broken)).toThrow(ElfError);
  });

  it('e_machine이 RISC-V가 아니면 ElfError다', () => {
    const broken = hello.slice();
    broken[E_MACHINE_OFFSET] = 0;
    broken[E_MACHINE_OFFSET + 1] = 0;
    expect(() => parseElf32(broken)).toThrow(ElfError);
  });

  it('잘린 파일은 ElfError다', () => {
    expect(() => parseElf32(hello.slice(0, EHDR_SIZE - 1))).toThrow(ElfError);
    expect(() => parseElf32(hello.slice(0, EHDR_SIZE + 4))).toThrow(ElfError);
  });
});

describe('loadElfIntoRam', () => {
  it('RAM 0번지에 첫 PT_LOAD 세그먼트를 올린다', () => {
    const image = parseElf32(new Uint8Array(readFileSync(HELLO_ELF)));
    const ram = new Uint8Array(RAM_BYTES);
    loadElfIntoRam(ram, image);
    const [first] = image.segments;
    if (first === undefined) throw new Error('PT_LOAD 세그먼트가 없다');
    expect(ram.subarray(0, 4)).toEqual(first.data.subarray(0, 4));
  });

  it('memsz가 filesz보다 크면 나머지를 0으로 채운다', () => {
    const image = parseElf32(buildElf({ paddr: RAM_BASE + 8, data: [1, 2, 3, 4], memsz: 12 }));
    const ram = new Uint8Array(RAM_BYTES).fill(0xff);
    loadElfIntoRam(ram, image);
    expect(Array.from(ram.subarray(6, 22))).toEqual([
      0xff, 0xff, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff,
    ]);
  });

  it('paddr이 RAM 밖인 세그먼트는 ElfError다', () => {
    const below = parseElf32(buildElf({ paddr: RAM_BASE - 4, data: [1], memsz: 1 }));
    expect(() => loadElfIntoRam(new Uint8Array(RAM_BYTES), below)).toThrow(ElfError);
    const past = parseElf32(buildElf({ paddr: RAM_BASE + RAM_BYTES - 2, data: [1], memsz: 4 }));
    expect(() => loadElfIntoRam(new Uint8Array(RAM_BYTES), past)).toThrow(ElfError);
  });

  it('하나라도 RAM 밖이면 아무것도 올리지 않는다', () => {
    const inside = parseElf32(buildElf({ paddr: RAM_BASE, data: [9], memsz: 1 }));
    const outside = parseElf32(buildElf({ paddr: 0, data: [9], memsz: 1 }));
    const image: ElfImage = {
      entry: RAM_BASE,
      segments: [...inside.segments, ...outside.segments],
      symbols: new Map(),
    };
    const ram = new Uint8Array(RAM_BYTES);
    expect(() => loadElfIntoRam(ram, image)).toThrow(ElfError);
    expect(ram[0]).toBe(0);
  });
});
