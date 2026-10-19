import { describe, expect, it } from 'vitest';

import { CSR } from '../src/cpu/csr';
import { setup } from './helpers/cpu';
import { div, divu, encodeR, mul, mulh, mulhsu, mulhu, rem, remu } from './helpers/encode';

type Op = typeof mul;

// x3 = x1 op x2
const exec = (op: Op, a: number, b: number): number => {
  const cpu = setup([op(3, 1, 2)]);
  cpu.x[1] = a;
  cpu.x[2] = b;
  cpu.step();
  return cpu.x[3] ?? Number.NaN;
};

type Case = { name: string; op: Op; a: number; b: number; expected: number };

const CASES: readonly Case[] = [
  { name: 'mul은 하위 32비트다', op: mul, a: 0xffff_ffff, b: 2, expected: 0xffff_fffe },
  { name: 'mul 오버플로', op: mul, a: 0x1_0000, b: 0x1_0000, expected: 0 },
  { name: 'mul 큰 수', op: mul, a: 0x1234_5678, b: 0x9abc_def0, expected: 0x242d_2080 },
  { name: 'mulh(-1, -1)', op: mulh, a: 0xffff_ffff, b: 0xffff_ffff, expected: 0 },
  { name: 'mulh 최솟값 제곱', op: mulh, a: 0x8000_0000, b: 0x8000_0000, expected: 0x4000_0000 },
  { name: 'mulh 최댓값 제곱', op: mulh, a: 0x7fff_ffff, b: 0x7fff_ffff, expected: 0x3fff_ffff },
  { name: 'mulh 음수 × 양수', op: mulh, a: 0xffff_ffff, b: 5, expected: 0xffff_ffff },
  { name: 'mulhu(최대, 최대)', op: mulhu, a: 0xffff_ffff, b: 0xffff_ffff, expected: 0xffff_fffe },
  { name: 'mulhu 올림', op: mulhu, a: 0x8000_0000, b: 2, expected: 1 },
  { name: 'mulhsu(-1, 최대)', op: mulhsu, a: 0xffff_ffff, b: 0xffff_ffff, expected: 0xffff_ffff },
  { name: 'mulhsu 음수 × 2', op: mulhsu, a: 0x8000_0000, b: 2, expected: 0xffff_ffff },
  { name: 'mulhsu 양수 × 큰 부호 없는 수', op: mulhsu, a: 2, b: 0xffff_ffff, expected: 1 },
  { name: 'div 0으로 나누면 모든 비트가 1', op: div, a: 7, b: 0, expected: 0xffff_ffff },
  { name: 'div 음수를 0으로 나눠도 같다', op: div, a: 0xffff_fff9, b: 0, expected: 0xffff_ffff },
  { name: 'divu 0으로 나누면 모든 비트가 1', op: divu, a: 7, b: 0, expected: 0xffff_ffff },
  { name: 'rem 0으로 나누면 피제수', op: rem, a: 7, b: 0, expected: 7 },
  { name: 'rem 음수 피제수를 0으로 나눈다', op: rem, a: 0x8000_0000, b: 0, expected: 0x8000_0000 },
  { name: 'remu 0으로 나누면 피제수', op: remu, a: 7, b: 0, expected: 7 },
  { name: 'div 오버플로는 피제수', op: div, a: 0x8000_0000, b: 0xffff_ffff, expected: 0x8000_0000 },
  { name: 'rem 오버플로는 0', op: rem, a: 0x8000_0000, b: 0xffff_ffff, expected: 0 },
  { name: 'div는 0 쪽으로 버린다(-7 / 2)', op: div, a: 0xffff_fff9, b: 2, expected: 0xffff_fffd },
  { name: 'div 양수 / 음수(7 / -2)', op: div, a: 7, b: 0xffff_fffe, expected: 0xffff_fffd },
  {
    name: 'rem 부호는 피제수를 따른다(-7 % 2)',
    op: rem,
    a: 0xffff_fff9,
    b: 2,
    expected: 0xffff_ffff,
  },
  { name: 'rem 양수 % 음수(7 % -2)', op: rem, a: 7, b: 0xffff_fffe, expected: 1 },
  {
    name: 'rem 음수 % 음수(-7 % -2)',
    op: rem,
    a: 0xffff_fff9,
    b: 0xffff_fffe,
    expected: 0xffff_ffff,
  },
  { name: 'divu는 부호 없이 나눈다', op: divu, a: 0xffff_ffff, b: 2, expected: 0x7fff_ffff },
  { name: 'remu는 부호 없이 나눈다', op: remu, a: 0xffff_ffff, b: 10, expected: 5 },
];

describe('RV32M 곱셈과 나눗셈', () => {
  it.each(CASES)('$name', ({ op, a, b, expected }) => {
    expect(exec(op, a, b)).toBe(expected);
  });

  it('pc를 4 늘리고 퇴직한다', () => {
    const cpu = setup([mul(3, 1, 2)]);
    const start = cpu.pc;
    cpu.step();
    expect(cpu.pc).toBe(start + 4);
    expect(cpu.readCsr(CSR.minstret)).toBe(1);
  });

  it('rd가 x0이면 결과를 버린다', () => {
    const cpu = setup([div(0, 1, 2)]);
    cpu.x[1] = 6;
    cpu.x[2] = 3;
    cpu.step();
    expect(cpu.x[0]).toBe(0);
  });

  it('funct7이 1도 0도 아닌 OP는 illegal instruction이다', () => {
    const word = encodeR(0x33, 0, 2, 3, 1, 2);
    const cpu = setup([word]);
    cpu.step();
    expect(cpu.readCsr(CSR.mcause)).toBe(2);
    expect(cpu.readCsr(CSR.mtval)).toBe(word);
  });
});

// BigInt로 정의대로 계산한 기준값. CPU 구현은 BigInt를 쓰지 않는다.
const asSigned = (x: number): bigint => BigInt.asIntN(32, BigInt(x));
const wrap = (x: bigint): number => Number(BigInt.asUintN(32, x));
const ALL_ONES = 0xffff_ffff;

const REFERENCE: readonly { name: string; op: Op; expect: (a: number, b: number) => number }[] = [
  { name: 'mul', op: mul, expect: (a, b) => wrap(BigInt(a) * BigInt(b)) },
  { name: 'mulh', op: mulh, expect: (a, b) => wrap((asSigned(a) * asSigned(b)) >> 32n) },
  { name: 'mulhsu', op: mulhsu, expect: (a, b) => wrap((asSigned(a) * BigInt(b)) >> 32n) },
  { name: 'mulhu', op: mulhu, expect: (a, b) => wrap((BigInt(a) * BigInt(b)) >> 32n) },
  {
    name: 'div',
    op: div,
    expect: (a, b) => (b === 0 ? ALL_ONES : wrap(asSigned(a) / asSigned(b))),
  },
  { name: 'divu', op: divu, expect: (a, b) => (b === 0 ? ALL_ONES : wrap(BigInt(a) / BigInt(b))) },
  { name: 'rem', op: rem, expect: (a, b) => (b === 0 ? a : wrap(asSigned(a) % asSigned(b))) },
  { name: 'remu', op: remu, expect: (a, b) => (b === 0 ? a : a % b) },
];

const EDGES = [
  0,
  1,
  2,
  3,
  0xffff,
  0x1_0000,
  0x7fff_ffff,
  0x8000_0000,
  0x8000_0001,
  0xffff_0000,
  ALL_ONES,
];

// 시드가 고정된 선형 합동 생성기라 실행마다 같은 입력이 나온다.
const randomPairs = (count: number): [number, number][] => {
  let state = 0x1234_5678;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  return Array.from({ length: count }, () => [next(), next()]);
};

const INPUTS: [number, number][] = [
  ...EDGES.flatMap((a): [number, number][] => EDGES.map((b) => [a, b])),
  ...randomPairs(300),
];

describe('RV32M 기준 구현과 대조', () => {
  it.each(REFERENCE)('$name은 BigInt 기준값과 같다', ({ op, expect: reference }) => {
    for (const [a, b] of INPUTS) {
      expect(exec(op, a, b), `a=0x${a.toString(16)} b=0x${b.toString(16)}`).toBe(reference(a, b));
    }
  });
});
