import { describe, expect, it } from 'vitest';

import { createBus } from '../src/bus';
import { Cpu } from '../src/cpu/cpu';
import { RAM_BASE } from '../src/memoryMap';
import {
  add,
  addi,
  and,
  andi,
  auipc,
  beq,
  bge,
  bgeu,
  blt,
  bltu,
  bne,
  fence,
  fenceI,
  jal,
  jalr,
  lb,
  lbu,
  lh,
  lhu,
  lui,
  lw,
  or,
  ori,
  sb,
  sh,
  sll,
  slli,
  slt,
  slti,
  sltiu,
  sltu,
  sra,
  srai,
  srl,
  srli,
  sub,
  sw,
  xor,
  xori,
} from './helpers/encode';

const RAM_BYTES = 0x1000;
const DATA = RAM_BASE + 0x100;

// words를 pc부터 RAM에 쓰고 pc에서 시작하는 CPU를 만든다.
const setup = (words: readonly number[], pc = RAM_BASE) => {
  const bus = createBus(new Uint8Array(RAM_BYTES), []);
  words.forEach((word, index) => {
    bus.write(pc + index * 4, 4, word);
  });
  const cpu = new Cpu(bus);
  cpu.pc = pc;
  return cpu;
};

describe('encode helper', () => {
  // llvm-mc --triple=riscv32 -show-encoding으로 얻은 워드다. 음수 즉시값의 비트 배치를 고정한다.
  it('어셈블러가 만든 워드와 같다', () => {
    expect(addi(1, 0, -1)).toBe(0xfff0_0093);
    expect(beq(1, 2, -8)).toBe(0xfe20_8ce3);
    expect(bltu(1, 2, -4096)).toBe(0x8020_e063);
    expect(jal(1, -4)).toBe(0xffdf_f0ef);
    expect(jal(5, 1_048_574)).toBe(0x7fff_f2ef);
    expect(sw(2, 5, -8)).toBe(0xfe22_ac23);
    expect(sh(2, 5, 2047)).toBe(0x7e22_9fa3);
    expect(lui(2, 0xf_ffff)).toBe(0xffff_f137);
    expect(srai(3, 1, 31)).toBe(0x41f0_d193);
    expect(sub(3, 1, 2)).toBe(0x4020_81b3);
    expect(jalr(1, 5, -1)).toBe(0xfff2_80e7);
    expect(fence()).toBe(0x0ff0_000f);
    expect(fenceI()).toBe(0x0000_100f);
  });
});

describe('RV32I 즉시값과 상위 비트', () => {
  it('addi는 즉시값을 부호 확장한다', () => {
    const cpu = setup([addi(1, 0, -1)]);
    cpu.step();
    expect(cpu.x[1]).toBe(0xffff_ffff);
    expect(cpu.pc).toBe(RAM_BASE + 4);
  });

  it('x0에 쓴 값은 버려진다', () => {
    const cpu = setup([addi(0, 0, 5)]);
    cpu.step();
    expect(cpu.x[0]).toBe(0);
  });

  it('lui는 상위 20비트를 채운다', () => {
    const cpu = setup([lui(2, 0x12345), lui(3, 0xf_ffff)]);
    cpu.run(2);
    expect(cpu.x[2]).toBe(0x1234_5000);
    expect(cpu.x[3]).toBe(0xffff_f000);
  });

  it('auipc는 명령어 자신의 pc에 더한다', () => {
    const cpu = setup([auipc(3, 1)]);
    cpu.step();
    expect(cpu.x[3]).toBe(RAM_BASE + 0x1000);

    const shifted = setup([auipc(3, 1)], RAM_BASE + 8);
    shifted.step();
    expect(shifted.x[3]).toBe(RAM_BASE + 8 + 0x1000);
  });

  it('auipc 결과는 32비트로 감긴다', () => {
    const cpu = setup([auipc(3, 0xf_ffff)]);
    cpu.step();
    expect(cpu.x[3]).toBe(0x7fff_f000);
  });
});

type AluCase = { name: string; word: number; x1: number; x2: number; expected: number };

// 레지스터 연산은 x3 = x1 op x2, 즉시값 연산은 x3 = x1 op imm이다.
const ALU_CASES: readonly AluCase[] = [
  { name: 'add 오버플로', word: add(3, 1, 2), x1: 0x7fff_ffff, x2: 1, expected: 0x8000_0000 },
  { name: 'add는 32비트로 감긴다', word: add(3, 1, 2), x1: 0xffff_ffff, x2: 1, expected: 0 },
  { name: 'sub는 0 아래로 감긴다', word: sub(3, 1, 2), x1: 5, x2: 7, expected: 0xffff_fffe },
  { name: 'slt는 부호 있는 비교', word: slt(3, 1, 2), x1: 0xffff_ffff, x2: 1, expected: 1 },
  { name: 'sltu는 부호 없는 비교', word: sltu(3, 1, 2), x1: 0xffff_ffff, x2: 1, expected: 0 },
  { name: 'sltu 참', word: sltu(3, 1, 2), x1: 1, x2: 0xffff_ffff, expected: 1 },
  { name: 'xor', word: xor(3, 1, 2), x1: 0xf0f0_f0f0, x2: 0xffff_0000, expected: 0x0f0f_f0f0 },
  { name: 'or', word: or(3, 1, 2), x1: 0xf0f0_f0f0, x2: 0x0000_ffff, expected: 0xf0f0_ffff },
  { name: 'and', word: and(3, 1, 2), x1: 0xf0f0_f0f0, x2: 0x00ff_ff00, expected: 0x00f0_f000 },
  { name: 'sll', word: sll(3, 1, 2), x1: 1, x2: 31, expected: 0x8000_0000 },
  { name: 'sll은 시프트 양의 하위 5비트만 쓴다', word: sll(3, 1, 2), x1: 3, x2: 33, expected: 6 },
  { name: 'srl', word: srl(3, 1, 2), x1: 0x8000_0000, x2: 4, expected: 0x0800_0000 },
  { name: 'srl 하위 5비트', word: srl(3, 1, 2), x1: 0x8000_0000, x2: 36, expected: 0x0800_0000 },
  {
    name: 'sra는 부호를 채운다',
    word: sra(3, 1, 2),
    x1: 0x8000_0000,
    x2: 4,
    expected: 0xf800_0000,
  },
  { name: 'sra 양수', word: sra(3, 1, 2), x1: 0x4000_0000, x2: 4, expected: 0x0400_0000 },
  { name: 'sra 하위 5비트', word: sra(3, 1, 2), x1: 0x8000_0000, x2: 36, expected: 0xf800_0000 },
  { name: 'addi 음수', word: addi(3, 1, -1), x1: 0, x2: 0, expected: 0xffff_ffff },
  { name: 'addi 오버플로', word: addi(3, 1, 1), x1: 0xffff_ffff, x2: 0, expected: 0 },
  { name: 'slti는 즉시값을 부호 확장', word: slti(3, 1, -1), x1: 0xffff_fffe, x2: 0, expected: 1 },
  { name: 'slti 거짓', word: slti(3, 1, -1), x1: 0, x2: 0, expected: 0 },
  {
    name: 'sltiu는 부호 확장한 값을 부호 없이 비교',
    word: sltiu(3, 1, -1),
    x1: 5,
    x2: 0,
    expected: 1,
  },
  { name: 'sltiu 거짓', word: sltiu(3, 1, -1), x1: 0xffff_ffff, x2: 0, expected: 0 },
  {
    name: 'xori -1은 비트 반전',
    word: xori(3, 1, -1),
    x1: 0x0f0f_0f0f,
    x2: 0,
    expected: 0xf0f0_f0f0,
  },
  { name: 'ori', word: ori(3, 1, 0x0f0), x1: 0x100, x2: 0, expected: 0x1f0 },
  {
    name: 'andi 음수 마스크',
    word: andi(3, 1, -16),
    x1: 0x1234_5678,
    x2: 0,
    expected: 0x1234_5670,
  },
  { name: 'slli', word: slli(3, 1, 31), x1: 1, x2: 0, expected: 0x8000_0000 },
  { name: 'srli', word: srli(3, 1, 31), x1: 0x8000_0000, x2: 0, expected: 1 },
  { name: 'srai 31', word: srai(3, 1, 31), x1: 0x8000_0000, x2: 0, expected: 0xffff_ffff },
  { name: 'srai 4', word: srai(3, 1, 4), x1: 0x8000_0000, x2: 0, expected: 0xf800_0000 },
];

describe('RV32I 산술과 비교', () => {
  it.each(ALU_CASES)('$name', ({ word, x1, x2, expected }) => {
    const cpu = setup([word]);
    cpu.x[1] = x1;
    cpu.x[2] = x2;
    cpu.step();
    expect(cpu.x[3]).toBe(expected);
    expect(cpu.pc).toBe(RAM_BASE + 4);
  });
});

describe('RV32I 메모리', () => {
  it('sw로 쓴 0x80을 lb는 부호 확장, lbu는 0 확장으로 읽는다', () => {
    const cpu = setup([sw(1, 5, 0), lb(2, 5, 0), lbu(3, 5, 0)]);
    cpu.x[1] = 0x80;
    cpu.x[5] = DATA;
    cpu.run(3);
    expect(cpu.x[2]).toBe(0xffff_ff80);
    expect(cpu.x[3]).toBe(0x80);
  });

  it('sh는 하위 16비트만 쓰고 lh는 부호 확장, lhu는 0 확장으로 읽는다', () => {
    const cpu = setup([sh(1, 5, 0), lh(2, 5, 0), lhu(3, 5, 0), lw(4, 5, 0)]);
    cpu.x[1] = 0x1234_8000;
    cpu.x[5] = DATA;
    cpu.run(4);
    expect(cpu.x[2]).toBe(0xffff_8000);
    expect(cpu.x[3]).toBe(0x8000);
    expect(cpu.x[4]).toBe(0x8000);
  });

  it('sb는 한 바이트만 쓴다', () => {
    const cpu = setup([sb(1, 5, 1), lw(2, 5, 0)]);
    cpu.x[1] = 0x1234_56ab;
    cpu.x[5] = DATA;
    cpu.run(2);
    expect(cpu.x[2]).toBe(0x0000_ab00);
  });

  it('lw는 음수 offset으로 sw가 쓴 값을 읽는다', () => {
    const cpu = setup([sw(1, 5, -8), lw(2, 5, -8)]);
    cpu.x[1] = 0xdead_beef;
    cpu.x[5] = DATA + 8;
    cpu.run(2);
    expect(cpu.x[2]).toBe(0xdead_beef);
  });
});

type BranchCase = { name: string; build: typeof beq; x1: number; x2: number; taken: boolean };

const BRANCH_CASES: readonly BranchCase[] = [
  { name: 'beq 같으면 점프', build: beq, x1: 5, x2: 5, taken: true },
  { name: 'beq 다르면 통과', build: beq, x1: 5, x2: 6, taken: false },
  { name: 'bne 다르면 점프', build: bne, x1: 5, x2: 6, taken: true },
  { name: 'bne 같으면 통과', build: bne, x1: 5, x2: 5, taken: false },
  { name: 'blt는 부호 있는 비교(-1 < 1)', build: blt, x1: 0xffff_ffff, x2: 1, taken: true },
  { name: 'blt 거짓', build: blt, x1: 1, x2: 0xffff_ffff, taken: false },
  { name: 'bge 참', build: bge, x1: 1, x2: 0xffff_ffff, taken: true },
  { name: 'bge 같으면 점프', build: bge, x1: 3, x2: 3, taken: true },
  { name: 'bge 거짓', build: bge, x1: 0xffff_ffff, x2: 1, taken: false },
  {
    name: 'bltu는 부호 없는 비교(1 < 0xFFFFFFFF)',
    build: bltu,
    x1: 1,
    x2: 0xffff_ffff,
    taken: true,
  },
  { name: 'bltu 거짓', build: bltu, x1: 0xffff_ffff, x2: 1, taken: false },
  { name: 'bgeu 참', build: bgeu, x1: 0xffff_ffff, x2: 1, taken: true },
  { name: 'bgeu 거짓', build: bgeu, x1: 1, x2: 0xffff_ffff, taken: false },
];

describe('RV32I 분기와 점프', () => {
  it.each(BRANCH_CASES)('$name', ({ build, x1, x2, taken }) => {
    const cpu = setup([build(1, 2, 16)]);
    cpu.x[1] = x1;
    cpu.x[2] = x2;
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + (taken ? 16 : 4));
  });

  it('분기는 음수 offset으로 뒤로 간다', () => {
    const cpu = setup([beq(1, 2, -16)], RAM_BASE + 0x20);
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + 0x10);
  });

  // 목표 주소를 가져오는 것은 다음 step이라 RAM 밖이어도 된다.
  it.each([0x7fe, 0x800, -0x800, 4094, -4096])(
    'beq는 offset %i의 모든 비트를 해독한다',
    (offset) => {
      const cpu = setup([beq(1, 2, offset)]);
      cpu.step();
      expect(cpu.pc).toBe(RAM_BASE + offset);
    },
  );

  it.each([0x7fe, 0x800, 0x1000, 0xff000, 1_048_574, -1_048_576])(
    'jal은 offset %i의 모든 비트를 해독한다',
    (offset) => {
      const cpu = setup([jal(1, offset)]);
      cpu.step();
      expect(cpu.pc).toBe(RAM_BASE + offset);
    },
  );

  it('jal은 되돌아갈 주소를 rd에 쓰고 pc + imm으로 간다', () => {
    const pc = RAM_BASE + 0x10;
    const cpu = setup([jal(1, 8)], pc);
    cpu.step();
    expect(cpu.x[1]).toBe(pc + 4);
    expect(cpu.pc).toBe(pc + 8);
  });

  it('jal은 음수 offset으로 뒤로 간다', () => {
    const cpu = setup([jal(1, -0x20)], RAM_BASE + 0x20);
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE);
    expect(cpu.x[1]).toBe(RAM_BASE + 0x24);
  });

  it('jal x0은 되돌아갈 주소를 남기지 않는다', () => {
    const cpu = setup([jal(0, 8)]);
    cpu.step();
    expect(cpu.x[0]).toBe(0);
    expect(cpu.pc).toBe(RAM_BASE + 8);
  });

  it('jalr은 목표 주소의 0번 비트를 지운다', () => {
    const cpu = setup([jalr(1, 5, 1)]);
    cpu.x[5] = RAM_BASE + 0x40;
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + 0x40);
    expect(cpu.x[1]).toBe(RAM_BASE + 4);
  });

  it('jalr은 음수 offset을 더한다', () => {
    const cpu = setup([jalr(0, 5, -4)]);
    cpu.x[5] = RAM_BASE + 0x44;
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + 0x40);
  });

  it('jalr은 rd를 쓰기 전의 rs1을 목표로 쓴다', () => {
    const cpu = setup([jalr(1, 1, 0)]);
    cpu.x[1] = RAM_BASE + 0x40;
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + 0x40);
    expect(cpu.x[1]).toBe(RAM_BASE + 4);
  });
});

describe('RV32I 그 밖', () => {
  it('fence와 fence.i는 pc만 4 늘린다', () => {
    const cpu = setup([fence(), fenceI()]);
    cpu.x[1] = 7;
    const before = Array.from(cpu.x);
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + 4);
    cpu.step();
    expect(cpu.pc).toBe(RAM_BASE + 8);
    expect(Array.from(cpu.x)).toEqual(before);
  });

  it('run은 실행한 명령 수를 돌려준다', () => {
    const cpu = setup([addi(1, 0, 1), addi(1, 1, 1), addi(1, 1, 1), addi(1, 1, 1)]);
    expect(cpu.run(3)).toBe(3);
    expect(cpu.x[1]).toBe(3);
    expect(cpu.pc).toBe(RAM_BASE + 12);
  });
});
