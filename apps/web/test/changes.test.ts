import { describe, expect, it } from 'vitest';

import { PRIVILEGE } from '@amulator/core/cpu/csr';
import type { CpuView, InspectedCsr } from '@amulator/core/inspect';

import { changedFields } from '../src/chapter/changes';

const ENTRY = 0x8000_0000;
const REGISTER_COUNT = 32;

type Overrides = {
  pc: number;
  x?: Record<number, number>;
  csr?: Partial<Record<InspectedCsr, number>>;
};

// 모두 0인 CpuView에 일부만 덮는다.
const view = ({ pc, x = {}, csr = {} }: Overrides): CpuView => {
  const registers = Array.from({ length: REGISTER_COUNT }, () => 0);
  for (const [index, value] of Object.entries(x)) registers[Number(index)] = value;
  return {
    pc,
    x: registers,
    privilege: PRIVILEGE.machine,
    idle: false,
    csr: { mstatus: 0, mtvec: 0, mepc: 0, mcause: 0, mie: 0, mip: 0, ...csr },
  };
};

describe('changedFields', () => {
  it('이전 상태가 없으면 아무것도 강조하지 않는다', () => {
    expect(changedFields(undefined, view({ pc: ENTRY }))).toEqual(new Set());
  });

  it('바뀐 pc, 레지스터, CSR만 고른다', () => {
    const before = view({ pc: ENTRY, x: { 2: 0 }, csr: { mtvec: 0 } });
    const after = view({ pc: ENTRY + 4, x: { 2: 0x8400_0000 }, csr: { mtvec: 0x8000_0044 } });
    expect(changedFields(before, after)).toEqual(new Set(['pc', 'x2', 'mtvec']));
  });

  it('같은 상태는 비어 있다', () => {
    const state = view({ pc: ENTRY, x: { 10: 7 } });
    expect(changedFields(state, view({ pc: ENTRY, x: { 10: 7 } }))).toEqual(new Set());
  });
});
