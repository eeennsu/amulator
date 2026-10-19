import { describe, expect, it } from 'vitest';

import { PRIVILEGE, type Cpu, type Privilege } from '../src/cpu/cpu';
import {
  CSR,
  MIP_MEIP,
  MIP_MSIP,
  MIP_MTIP,
  MISA_VALUE,
  MSTATUS_MIE,
  MSTATUS_MPIE,
  MSTATUS_MPP,
} from '../src/cpu/csr';
import { RAM_BASE } from '../src/memoryMap';
import { setup } from './helpers/cpu';
import {
  addi,
  beq,
  bne,
  csrr,
  csrrc,
  csrrci,
  csrrs,
  csrrsi,
  csrrw,
  csrrwi,
  ebreak,
  ecall,
  encodeB,
  encodeI,
  encodeR,
  jal,
  jalr,
  lw,
  mret,
  sw,
  wfi,
} from './helpers/encode';

const PC = RAM_BASE + 0x20;
const HANDLER = RAM_BASE + 0x100;
const UNMAPPED = 0x2000_0000;
const INTERRUPT = 0x8000_0000;

// 핸들러 주소를 정한 CPU를 PC에서 시작한다.
const trapCpu = (words: readonly number[], privilege: Privilege = PRIVILEGE.machine) => {
  const cpu = setup(words, PC);
  cpu.writeCsr(CSR.mtvec, HANDLER);
  cpu.privilege = privilege;
  return cpu;
};

const expectTrap = (cpu: Cpu, cause: number, tval: number, mepc = PC): void => {
  expect(cpu.readCsr(CSR.mcause)).toBe(cause);
  expect(cpu.readCsr(CSR.mtval)).toBe(tval);
  expect(cpu.readCsr(CSR.mepc)).toBe(mepc);
  expect(cpu.privilege).toBe(PRIVILEGE.machine);
  expect(cpu.pc).toBe(HANDLER);
};

describe('ecall과 ebreak', () => {
  it('U 모드 ecall은 cause 8로 M 모드 핸들러에 들어가고 MPP는 U다', () => {
    const cpu = trapCpu([ecall()], PRIVILEGE.user);
    cpu.step();
    expectTrap(cpu, 8, 0);
    expect(cpu.readCsr(CSR.mstatus) & MSTATUS_MPP).toBe(0);
  });

  it('M 모드 ecall은 cause 11이고 MPP는 M이다', () => {
    const cpu = trapCpu([ecall()]);
    cpu.step();
    expectTrap(cpu, 11, 0);
    expect(cpu.readCsr(CSR.mstatus) & MSTATUS_MPP).toBe(MSTATUS_MPP);
  });

  it('트랩은 MIE를 MPIE로 옮기고 MIE를 끈다', () => {
    const cpu = trapCpu([ecall()]);
    cpu.writeCsr(CSR.mstatus, MSTATUS_MIE);
    cpu.step();
    expect(cpu.readCsr(CSR.mstatus)).toBe(MSTATUS_MPIE | MSTATUS_MPP);
  });

  it('MIE가 꺼져 있었으면 MPIE도 꺼진다', () => {
    const cpu = trapCpu([ecall()]);
    cpu.writeCsr(CSR.mstatus, MSTATUS_MPIE);
    cpu.step();
    expect(cpu.readCsr(CSR.mstatus)).toBe(MSTATUS_MPP);
  });

  it('ebreak은 cause 3이고 mtval이 pc다', () => {
    const cpu = trapCpu([ebreak()]);
    cpu.step();
    expectTrap(cpu, 3, PC);
  });

  it('트랩한 명령어는 퇴직하지 않는다', () => {
    const cpu = trapCpu([addi(1, 0, 1), ecall()]);
    cpu.run(2);
    expect(cpu.readCsr(CSR.minstret)).toBe(1);
  });
});

describe('mret', () => {
  const RETURN = RAM_BASE + 0x40;

  it('mepc로 돌아가 MPP의 모드로 복귀하고 MIE ← MPIE, MPIE ← 1, MPP ← U다', () => {
    const cpu = trapCpu([mret()]);
    cpu.writeCsr(CSR.mepc, RETURN);
    cpu.writeCsr(CSR.mstatus, MSTATUS_MPIE);
    cpu.step();
    expect(cpu.pc).toBe(RETURN);
    expect(cpu.privilege).toBe(PRIVILEGE.user);
    expect(cpu.readCsr(CSR.mstatus)).toBe(MSTATUS_MIE | MSTATUS_MPIE);
  });

  it('MPIE가 0이면 MIE도 0이 되고 MPP가 M이면 M에 남는다', () => {
    const cpu = trapCpu([mret()]);
    cpu.writeCsr(CSR.mepc, RETURN);
    cpu.writeCsr(CSR.mstatus, MSTATUS_MPP);
    cpu.step();
    expect(cpu.privilege).toBe(PRIVILEGE.machine);
    expect(cpu.readCsr(CSR.mstatus)).toBe(MSTATUS_MPIE);
  });

  it('U 모드의 mret은 illegal instruction이다', () => {
    const cpu = trapCpu([mret()], PRIVILEGE.user);
    cpu.step();
    expectTrap(cpu, 2, mret());
  });

  it('mepc의 하위 2비트는 0으로 고정된다', () => {
    const cpu = trapCpu([mret()]);
    cpu.writeCsr(CSR.mepc, RETURN + 3);
    expect(cpu.readCsr(CSR.mepc)).toBe(RETURN);
    cpu.step();
    expect(cpu.pc).toBe(RETURN);
  });
});

describe('CSR 접근', () => {
  it('csrrw는 이전 값을 rd에 돌려주고 새 값을 쓴다', () => {
    const cpu = trapCpu([csrrw(1, CSR.mscratch, 2)]);
    cpu.writeCsr(CSR.mscratch, 0x1111);
    cpu.x[2] = 0x2222;
    cpu.step();
    expect(cpu.x[1]).toBe(0x1111);
    expect(cpu.readCsr(CSR.mscratch)).toBe(0x2222);
    expect(cpu.pc).toBe(PC + 4);
  });

  it('csrrs x1, mvendorid, x0은 트랩 없이 0을 읽는다', () => {
    const cpu = trapCpu([csrrs(1, CSR.mvendorid, 0)]);
    cpu.x[1] = 7;
    cpu.step();
    expect(cpu.x[1]).toBe(0);
    expect(cpu.pc).toBe(PC + 4);
  });

  it('읽기 전용 CSR에 쓰면 illegal instruction이고 mtval은 명령어 워드다', () => {
    const word = csrrw(0, CSR.mvendorid, 1);
    const cpu = trapCpu([word]);
    cpu.step();
    expectTrap(cpu, 2, word);
  });

  it('쓰지 않는 CSR 명령어는 읽기 전용 CSR에도 쓸 수 있다', () => {
    const cpu = trapCpu([csrrsi(1, CSR.mhartid, 0), csrrc(2, CSR.mimpid, 0)]);
    cpu.run(2);
    expect(cpu.pc).toBe(PC + 8);
  });

  it.each([
    ['csrrci uimm 1', csrrci(1, CSR.mvendorid, 1)],
    ['csrrs rs1 x2', csrrs(1, CSR.mvendorid, 2)],
    ['csrrwi uimm 0', csrrwi(1, CSR.marchid, 0)],
    ['사용자 shadow cycle', csrrw(0, CSR.cycle, 1)],
  ])('%s는 쓰기라서 읽기 전용 CSR에 illegal이다', (_name, word) => {
    const cpu = trapCpu([word]);
    cpu.x[2] = 1;
    cpu.step();
    expectTrap(cpu, 2, word);
  });

  it('U 모드에서 M 모드 CSR을 읽으면 illegal instruction이다', () => {
    const word = csrr(1, CSR.mstatus);
    const cpu = trapCpu([word], PRIVILEGE.user);
    cpu.step();
    expectTrap(cpu, 2, word);
  });

  it('없는 CSR은 illegal instruction이다', () => {
    const word = csrr(1, 0x7c0);
    const cpu = trapCpu([word]);
    cpu.step();
    expectTrap(cpu, 2, word);
  });

  it('misa는 RV32 I·M·U를 읽는다', () => {
    const cpu = trapCpu([csrr(1, CSR.misa)]);
    cpu.step();
    expect(cpu.x[1]).toBe(MISA_VALUE);
    expect(MISA_VALUE).toBe(0x4010_1100);
  });

  it('misa에 쓴 값은 무시된다', () => {
    const cpu = trapCpu([csrrw(0, CSR.misa, 1)]);
    cpu.x[1] = 0xffff_ffff;
    cpu.step();
    expect(cpu.readCsr(CSR.misa)).toBe(MISA_VALUE);
  });

  it('pmpaddr0에 쓴 값은 무시되고 0을 읽는다', () => {
    const cpu = trapCpu([csrrw(2, CSR.pmpaddr0, 1), csrr(3, CSR.pmpaddr0)]);
    cpu.x[1] = 0xffff_ffff;
    cpu.run(2);
    expect(cpu.x[2]).toBe(0);
    expect(cpu.x[3]).toBe(0);
  });

  it.each([CSR.pmpcfg0, CSR.pmpcfg3, CSR.pmpaddr0, CSR.pmpaddr15])(
    'PMP CSR %i번은 0을 읽고 쓰기를 무시한다',
    (address) => {
      const cpu = trapCpu([]);
      cpu.writeCsr(address, 0xffff_ffff);
      expect(cpu.readCsr(address)).toBe(0);
    },
  );

  type CsrCase = {
    name: string;
    word: number;
    initial: number;
    x1: number;
    rd: number;
    after: number;
  };
  const CSR_CASES: readonly CsrCase[] = [
    {
      name: 'csrrw',
      word: csrrw(3, CSR.mscratch, 1),
      initial: 0b1010,
      x1: 0b1100,
      rd: 0b1010,
      after: 0b1100,
    },
    {
      name: 'csrrs는 비트를 켠다',
      word: csrrs(3, CSR.mscratch, 1),
      initial: 0b1010,
      x1: 0b1100,
      rd: 0b1010,
      after: 0b1110,
    },
    {
      name: 'csrrc는 비트를 끈다',
      word: csrrc(3, CSR.mscratch, 1),
      initial: 0b1010,
      x1: 0b1100,
      rd: 0b1010,
      after: 0b0010,
    },
    {
      name: 'csrrs rs1=x0은 쓰지 않는다',
      word: csrrs(3, CSR.mscratch, 0),
      initial: 0b1010,
      x1: 0b1100,
      rd: 0b1010,
      after: 0b1010,
    },
    {
      name: 'csrrwi',
      word: csrrwi(3, CSR.mscratch, 17),
      initial: 0b1010,
      x1: 0,
      rd: 0b1010,
      after: 17,
    },
    {
      name: 'csrrwi uimm 0은 0을 쓴다',
      word: csrrwi(3, CSR.mscratch, 0),
      initial: 0b1010,
      x1: 0,
      rd: 0b1010,
      after: 0,
    },
    {
      name: 'csrrsi',
      word: csrrsi(3, CSR.mscratch, 0b0101),
      initial: 0b1010,
      x1: 0,
      rd: 0b1010,
      after: 0b1111,
    },
    {
      name: 'csrrsi uimm 0은 쓰지 않는다',
      word: csrrsi(3, CSR.mscratch, 0),
      initial: 0b1010,
      x1: 0,
      rd: 0b1010,
      after: 0b1010,
    },
    {
      name: 'csrrci',
      word: csrrci(3, CSR.mscratch, 0b0010),
      initial: 0b1010,
      x1: 0,
      rd: 0b1010,
      after: 0b1000,
    },
    {
      name: 'csrrc는 32비트 전체를 다룬다',
      word: csrrc(3, CSR.mscratch, 1),
      initial: 0xffff_ffff,
      x1: 0x8000_0001,
      rd: 0xffff_ffff,
      after: 0x7fff_fffe,
    },
  ];

  it.each(CSR_CASES)('$name', ({ word, initial, x1, rd, after }) => {
    const cpu = trapCpu([word]);
    cpu.writeCsr(CSR.mscratch, initial);
    cpu.x[1] = x1;
    cpu.step();
    expect(cpu.x[3]).toBe(rd);
    expect(cpu.readCsr(CSR.mscratch)).toBe(after);
  });

  it('rd가 rs1과 같아도 쓴 값이 아니라 이전 값이 rd로 간다', () => {
    const cpu = trapCpu([csrrw(1, CSR.mscratch, 1)]);
    cpu.writeCsr(CSR.mscratch, 5);
    cpu.x[1] = 9;
    cpu.step();
    expect(cpu.x[1]).toBe(5);
    expect(cpu.readCsr(CSR.mscratch)).toBe(9);
  });

  it('illegal CSR 접근은 rd와 CSR을 바꾸지 않는다', () => {
    const cpu = trapCpu([csrrw(1, CSR.mvendorid, 2)]);
    cpu.x[1] = 0x55;
    cpu.x[2] = 0x66;
    cpu.step();
    expect(cpu.x[1]).toBe(0x55);
    expect(cpu.readCsr(CSR.mvendorid)).toBe(0);
  });
});

describe('WARL 필드', () => {
  it('mtvec의 하위 2비트는 0으로 고정된다(direct 모드만)', () => {
    const cpu = trapCpu([]);
    cpu.writeCsr(CSR.mtvec, HANDLER + 3);
    expect(cpu.readCsr(CSR.mtvec)).toBe(HANDLER);
  });

  it('mstatus는 MIE·MPIE·MPP만 쓸 수 있다', () => {
    const cpu = trapCpu([]);
    cpu.writeCsr(CSR.mstatus, 0xffff_ffff);
    expect(cpu.readCsr(CSR.mstatus)).toBe(MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP);
  });

  it.each([1, 2])('MPP에 %i를 쓰면 0이 된다', (mpp) => {
    const cpu = trapCpu([]);
    cpu.writeCsr(CSR.mstatus, mpp << 11);
    expect(cpu.readCsr(CSR.mstatus)).toBe(0);
  });

  it('mie는 MSIE·MTIE·MEIE만 쓸 수 있다', () => {
    const cpu = trapCpu([]);
    cpu.writeCsr(CSR.mie, 0xffff_ffff);
    expect(cpu.readCsr(CSR.mie)).toBe(MIP_MSIP | MIP_MTIP | MIP_MEIP);
  });

  it('mip는 쓰기를 무시하고 setInterruptPending만 바꾼다', () => {
    const cpu = trapCpu([]);
    cpu.writeCsr(CSR.mip, 0xffff_ffff);
    expect(cpu.readCsr(CSR.mip)).toBe(0);
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.setInterruptPending(MIP_MSIP, true);
    expect(cpu.readCsr(CSR.mip)).toBe(MIP_MTIP | MIP_MSIP);
    cpu.setInterruptPending(MIP_MTIP, false);
    expect(cpu.readCsr(CSR.mip)).toBe(MIP_MSIP);
  });

  it('mcounteren은 CY·TM·IR 세 비트만 쓸 수 있다', () => {
    const cpu = trapCpu([]);
    cpu.writeCsr(CSR.mcounteren, 0xffff_ffff);
    expect(cpu.readCsr(CSR.mcounteren)).toBe(0b111);
  });

  it('없는 CSR을 readCsr·writeCsr하면 던진다', () => {
    const cpu = trapCpu([]);
    expect(() => cpu.readCsr(0x7c0)).toThrow(RangeError);
    expect(() => {
      cpu.writeCsr(0x7c0, 1);
    }).toThrow(RangeError);
  });
});

describe('카운터', () => {
  it('minstret과 mcycle은 퇴직한 명령어마다 하나 늘고, 읽는 명령어는 자기 증가 전의 값을 본다', () => {
    const cpu = setup([addi(1, 0, 1), addi(1, 1, 1), csrr(2, CSR.minstret)], PC);
    cpu.run(3);
    expect(cpu.x[2]).toBe(2);
    expect(cpu.readCsr(CSR.minstret)).toBe(3);
    expect(cpu.readCsr(CSR.mcycle)).toBe(3);
  });

  it('64비트로 세고 올림이 상위 CSR로 전파된다', () => {
    const cpu = setup([addi(0, 0, 0)], PC);
    cpu.writeCsr(CSR.minstret, 0xffff_ffff);
    cpu.writeCsr(CSR.mcycle, 0xffff_ffff);
    cpu.writeCsr(CSR.minstreth, 7);
    cpu.step();
    expect(cpu.readCsr(CSR.minstret)).toBe(0);
    expect(cpu.readCsr(CSR.minstreth)).toBe(8);
    expect(cpu.readCsr(CSR.mcycle)).toBe(0);
    expect(cpu.readCsr(CSR.mcycleh)).toBe(1);
  });

  it('64비트 전체가 넘치면 0으로 돌아간다', () => {
    const cpu = setup([addi(0, 0, 0)], PC);
    cpu.writeCsr(CSR.minstret, 0xffff_ffff);
    cpu.writeCsr(CSR.minstreth, 0xffff_ffff);
    cpu.step();
    expect(cpu.readCsr(CSR.minstret)).toBe(0);
    expect(cpu.readCsr(CSR.minstreth)).toBe(0);
  });

  // riscv-tests rv64mi/instret_overflow: 쓴 값은 그 명령어 자신의 증가에 덮이지 않는다.
  it('minstret을 쓰는 명령어는 자기 증가를 건너뛴다', () => {
    const cpu = setup([csrrwi(0, CSR.minstret, 0), csrr(10, CSR.minstret)], PC);
    cpu.writeCsr(CSR.minstret, 100);
    cpu.run(2);
    expect(cpu.x[10]).toBe(0);
    expect(cpu.readCsr(CSR.minstret)).toBe(1);
  });

  it('minstreth를 쓰는 명령어도 증가를 건너뛴다', () => {
    const cpu = setup(
      [
        csrrw(0, CSR.minstret, 5),
        csrrw(0, CSR.minstreth, 5),
        addi(0, 0, 0),
        csrr(10, CSR.minstret),
        csrr(11, CSR.minstreth),
      ],
      PC,
    );
    cpu.x[5] = 0xffff_ffff;
    cpu.run(5);
    expect(cpu.x[10]).toBe(0);
    expect(cpu.x[11]).toBe(0);
  });

  it('mcycle을 쓰는 명령어도 증가를 건너뛴다', () => {
    const cpu = setup([csrrwi(0, CSR.mcycle, 0), csrr(10, CSR.mcycle)], PC);
    cpu.writeCsr(CSR.mcycle, 100);
    cpu.run(2);
    expect(cpu.x[10]).toBe(0);
  });

  it('readTime의 64비트 값을 time과 timeh로 나눠 읽는다', () => {
    const cpu = setup([csrr(1, CSR.time), csrr(2, CSR.timeh)], PC, () => 0x1_2345_6789);
    cpu.run(2);
    expect(cpu.x[1]).toBe(0x2345_6789);
    expect(cpu.x[2]).toBe(1);
  });

  it('time은 2^53 - 1까지 정확히 나뉜다', () => {
    const cpu = setup([csrr(1, CSR.time), csrr(2, CSR.timeh)], PC, () => Number.MAX_SAFE_INTEGER);
    cpu.run(2);
    expect(cpu.x[1]).toBe(0xffff_ffff);
    expect(cpu.x[2]).toBe(0x1f_ffff);
  });

  const USER_COUNTERS = [
    { name: 'cycle', address: CSR.cycle, bit: 1 },
    { name: 'cycleh', address: CSR.cycleh, bit: 1 },
    { name: 'time', address: CSR.time, bit: 2 },
    { name: 'timeh', address: CSR.timeh, bit: 2 },
    { name: 'instret', address: CSR.instret, bit: 4 },
    { name: 'instreth', address: CSR.instreth, bit: 4 },
  ];

  describe.each(USER_COUNTERS)('$name', ({ address, bit }) => {
    const word = csrr(1, address);

    it('mcounteren이 꺼져 있으면 U 모드에서 illegal이다', () => {
      const cpu = trapCpu([word], PRIVILEGE.user);
      cpu.writeCsr(CSR.mcounteren, 0b111 & ~bit);
      cpu.step();
      expectTrap(cpu, 2, word);
    });

    it('mcounteren이 켜져 있으면 U 모드에서 읽는다', () => {
      const cpu = trapCpu([word], PRIVILEGE.user);
      cpu.writeCsr(CSR.mcounteren, bit);
      cpu.step();
      expect(cpu.pc).toBe(PC + 4);
    });

    it('M 모드는 mcounteren과 무관하게 읽는다', () => {
      const cpu = trapCpu([word]);
      cpu.step();
      expect(cpu.pc).toBe(PC + 4);
    });
  });

  it('U 모드에서 mcycle은 mcounteren이 켜져 있어도 illegal이다', () => {
    const word = csrr(1, CSR.mcycle);
    const cpu = trapCpu([word], PRIVILEGE.user);
    cpu.writeCsr(CSR.mcounteren, 0b111);
    cpu.step();
    expectTrap(cpu, 2, word);
  });
});

describe('illegal instruction', () => {
  const ILLEGAL = [
    ['모든 비트가 0인 워드', 0],
    ['모든 비트가 1인 워드', 0xffff_ffff],
    ['funct3가 없는 branch', encodeB(0x63, 2, 1, 2, 8)],
    ['funct3가 없는 load', encodeI(0x03, 3, 1, 2, 0)],
    ['funct3가 없는 store', encodeI(0x23, 3, 1, 2, 0)],
    ['funct7이 없는 OP', encodeR(0x33, 0, 2, 3, 1, 2)],
    ['funct7이 없는 OP-IMM 시프트', encodeI(0x13, 1, 3, 1, 0x40 << 5)],
    ['funct3가 없는 jalr', encodeI(0x67, 1, 1, 2, 0)],
    ['funct3가 없는 fence', encodeI(0x0f, 2, 0, 0, 0)],
    ['sret(S 모드 없음)', 0x1020_0073],
    ['rd가 있는 ecall', 0x0000_00f3],
    ['funct3 4인 SYSTEM', 0x0000_4073],
  ] as const;

  it.each(ILLEGAL)('%s는 cause 2이고 mtval이 명령어 워드다', (_name, word) => {
    const cpu = trapCpu([word]);
    cpu.x[1] = 0x1234;
    cpu.step();
    expectTrap(cpu, 2, word);
    expect(cpu.x[1]).toBe(0x1234);
    expect(cpu.readCsr(CSR.minstret)).toBe(0);
  });
});

describe('주소 예외', () => {
  it('목표 주소의 1번 비트가 선 jal은 cause 0이고 rd는 바뀌지 않는다', () => {
    const cpu = trapCpu([jal(1, 6)]);
    cpu.x[1] = 0x1234;
    cpu.step();
    expectTrap(cpu, 0, PC + 6);
    expect(cpu.x[1]).toBe(0x1234);
  });

  it('jalr은 0번 비트를 지운 목표 주소가 어긋나 있으면 cause 0이다', () => {
    const cpu = trapCpu([jalr(1, 5, 0)]);
    cpu.x[1] = 0x1234;
    cpu.x[5] = RAM_BASE + 0x43;
    cpu.step();
    expectTrap(cpu, 0, RAM_BASE + 0x42);
    expect(cpu.x[1]).toBe(0x1234);
  });

  it('잡히는 분기가 어긋난 목표로 가면 cause 0이다', () => {
    const cpu = trapCpu([beq(0, 0, 6)]);
    cpu.step();
    expectTrap(cpu, 0, PC + 6);
  });

  it('잡히지 않는 분기는 목표가 어긋나 있어도 트랩하지 않는다', () => {
    const cpu = trapCpu([bne(0, 0, 6)]);
    cpu.step();
    expect(cpu.pc).toBe(PC + 4);
  });

  it('RAM 밖의 명령어를 가져오면 cause 1이고 mtval이 pc다', () => {
    const cpu = trapCpu([]);
    cpu.pc = UNMAPPED;
    cpu.step();
    expectTrap(cpu, 1, UNMAPPED, UNMAPPED);
  });

  it('매핑되지 않은 주소의 lw는 cause 5이고 rd는 바뀌지 않는다', () => {
    const cpu = trapCpu([lw(1, 5, 4)]);
    cpu.x[1] = 0x77;
    cpu.x[5] = UNMAPPED;
    cpu.step();
    expectTrap(cpu, 5, UNMAPPED + 4);
    expect(cpu.x[1]).toBe(0x77);
  });

  it('매핑되지 않은 주소의 sw는 cause 7이다', () => {
    const cpu = trapCpu([sw(1, 5, 8)]);
    cpu.x[5] = UNMAPPED;
    cpu.step();
    expectTrap(cpu, 7, UNMAPPED + 8);
  });
});

describe('인터럽트', () => {
  const arm = (cpu: Cpu, enabled: number, globallyEnabled: boolean): void => {
    cpu.writeCsr(CSR.mie, enabled);
    cpu.writeCsr(CSR.mstatus, globallyEnabled ? MSTATUS_MIE : 0);
  };

  it('MTIE와 MIE가 켜져 있으면 다음 명령을 실행하기 전에 MTI를 건다', () => {
    const cpu = trapCpu([addi(1, 0, 1)]);
    arm(cpu, MIP_MTIP, true);
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expectTrap(cpu, INTERRUPT + 7, 0);
    expect(cpu.x[1]).toBe(0);
    expect(cpu.readCsr(CSR.minstret)).toBe(0);
    expect(cpu.readCsr(CSR.mstatus)).toBe(MSTATUS_MPIE | MSTATUS_MPP);
  });

  it('M 모드에서 MIE가 0이면 걸리지 않는다', () => {
    const cpu = trapCpu([addi(1, 0, 1)]);
    arm(cpu, MIP_MTIP, false);
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expect(cpu.x[1]).toBe(1);
    expect(cpu.pc).toBe(PC + 4);
  });

  it('U 모드에서는 MIE가 0이어도 걸리고 MPP는 U다', () => {
    const cpu = trapCpu([addi(1, 0, 1)], PRIVILEGE.user);
    arm(cpu, MIP_MTIP, false);
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expectTrap(cpu, INTERRUPT + 7, 0);
    expect(cpu.readCsr(CSR.mstatus) & MSTATUS_MPP).toBe(0);
  });

  it('mie에서 꺼진 인터럽트는 pending이어도 걸리지 않는다', () => {
    const cpu = trapCpu([addi(1, 0, 1)]);
    arm(cpu, MIP_MSIP, true);
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expect(cpu.x[1]).toBe(1);
  });

  it.each([
    ['MEI > MSI > MTI', MIP_MEIP | MIP_MSIP | MIP_MTIP, 11],
    ['MSI > MTI', MIP_MSIP | MIP_MTIP, 3],
    ['MTI', MIP_MTIP, 7],
    ['MEI', MIP_MEIP, 11],
  ])('우선순위 %s', (_name, pending, code) => {
    const cpu = trapCpu([addi(1, 0, 1)]);
    arm(cpu, pending, true);
    for (const bit of [MIP_MEIP, MIP_MSIP, MIP_MTIP]) {
      cpu.setInterruptPending(bit, (pending & bit) !== 0);
    }
    cpu.step();
    expectTrap(cpu, INTERRUPT + code, 0);
  });
});

describe('wfi', () => {
  it('idle로 만들고 pc를 4 늘리며 퇴직한다', () => {
    const cpu = trapCpu([wfi(), addi(1, 0, 1)]);
    cpu.step();
    expect(cpu.idle).toBe(true);
    expect(cpu.pc).toBe(PC + 4);
    expect(cpu.readCsr(CSR.minstret)).toBe(1);
  });

  it('idle이고 깨울 인터럽트가 없으면 step은 아무것도 하지 않는다', () => {
    const cpu = trapCpu([wfi(), addi(1, 0, 1)]);
    cpu.step();
    cpu.step();
    cpu.step();
    expect(cpu.idle).toBe(true);
    expect(cpu.pc).toBe(PC + 4);
    expect(cpu.x[1]).toBe(0);
    expect(cpu.readCsr(CSR.minstret)).toBe(1);
  });

  it('mie에서 꺼진 pending은 깨우지 않는다', () => {
    const cpu = trapCpu([wfi(), addi(1, 0, 1)]);
    cpu.step();
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expect(cpu.idle).toBe(true);
    expect(cpu.x[1]).toBe(0);
  });

  it('pending이고 mie에 켜져 있으면 MIE가 0이어도 깨어나 다음 명령을 실행한다', () => {
    const cpu = trapCpu([wfi(), addi(1, 0, 1)]);
    cpu.writeCsr(CSR.mie, MIP_MTIP);
    cpu.step();
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expect(cpu.idle).toBe(false);
    expect(cpu.x[1]).toBe(1);
    expect(cpu.readCsr(CSR.mcause)).toBe(0);
  });

  it('MIE도 켜져 있으면 깨어나며 인터럽트를 걸고 mepc는 wfi 다음 명령이다', () => {
    const cpu = trapCpu([wfi(), addi(1, 0, 1)]);
    cpu.writeCsr(CSR.mie, MIP_MTIP);
    cpu.writeCsr(CSR.mstatus, MSTATUS_MIE);
    cpu.step();
    cpu.setInterruptPending(MIP_MTIP, true);
    cpu.step();
    expect(cpu.idle).toBe(false);
    expectTrap(cpu, INTERRUPT + 7, 0, PC + 4);
    expect(cpu.x[1]).toBe(0);
  });
});
