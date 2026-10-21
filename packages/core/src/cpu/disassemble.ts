import { CSR } from './csr';

export const ABI_REGISTER_NAMES: readonly string[] = [
  'zero',
  'ra',
  'sp',
  'gp',
  'tp',
  't0',
  't1',
  't2',
  's0',
  's1',
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  't3',
  't4',
  't5',
  't6',
];

const UNKNOWN = '<unknown>';
const HEX = 16;
const UPPER_20_SHIFT = 12;
const ALT_FUNCT7 = 0x20; // sub, sra, srai
const MULDIV_FUNCT7 = 0x01;
const SFENCE_VMA_FUNCT7 = 0x09;
const FENCE_BITS = ['i', 'o', 'r', 'w'] as const;
const FENCE_FIELD_MASK = 0xf;

// 디코드 표는 cpu.ts와 같은 구분이지만 일부러 따로 둔다. 실행과 표기는 따로 바뀔 수 있다.
const OPCODE = {
  load: 0x03,
  miscMem: 0x0f,
  opImm: 0x13,
  auipc: 0x17,
  store: 0x23,
  op: 0x33,
  lui: 0x37,
  branch: 0x63,
  jalr: 0x67,
  jal: 0x6f,
  system: 0x73,
} as const;

const SYSTEM_WORD = new Map<number, string>([
  [0x0000_0073, 'ecall'],
  [0x0010_0073, 'ebreak'],
  [0x1020_0073, 'sret'],
  [0x3020_0073, 'mret'],
  [0x1050_0073, 'wfi'],
  [0xc000_1073, 'unimp'], // csrrw zero, cycle, zero
]);

// 인덱스가 funct3다. 빈 칸은 없는 명령어다.
const ALU_IMM = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi'] as const;
const ALU_REG = ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and'] as const;
const MULDIV = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'] as const;
const BRANCH = ['beq', 'bne', undefined, undefined, 'blt', 'bge', 'bltu', 'bgeu'] as const;
const LOAD = ['lb', 'lh', 'lw', undefined, 'lbu', 'lhu', undefined, undefined] as const;
const STORE = ['sb', 'sh', 'sw'] as const;
const CSR_REG = [undefined, 'csrrw', 'csrrs', 'csrrc'] as const;
const CSR_IMM = [undefined, 'csrrwi', 'csrrsi', 'csrrci'] as const;
const FUNCT3_SLL = 1;
const FUNCT3_SHIFT_RIGHT = 5;
const FUNCT3_ADD = 0;
const FUNCT3_MISC_FENCE = 0;
const FUNCT3_MISC_FENCE_I = 1;
const CSR_IMMEDIATE_BIT = 0x4;
const CSR_OP_MASK = 0x3;

const CSR_NAMES = new Map<number, string>(Object.entries(CSR).map(([name, id]) => [id, name]));

const reg = (index: number): string => ABI_REGISTER_NAMES[index] ?? UNKNOWN;
const hex = (value: number): string =>
  value < 0 ? `-0x${(-value).toString(HEX)}` : `0x${value.toString(HEX)}`;

// 즉시값은 부호 있는 수다. inst는 부호 없는 32비트 수다.
const immI = (inst: number): number => inst >> 20;
const immS = (inst: number): number => ((inst >> 25) << 5) | ((inst >>> 7) & 0x1f);
const immB = (inst: number): number =>
  ((inst >> 31) << 12) | ((inst & 0x80) << 4) | ((inst >>> 20) & 0x7e0) | ((inst >>> 7) & 0x1e);
const immJ = (inst: number): number =>
  ((inst >> 31) << 20) | (inst & 0xff000) | ((inst >>> 9) & 0x800) | ((inst >>> 20) & 0x7fe);

const address = (pc: number, offset: number): string => hex((pc + offset) >>> 0);

// 비트가 하나도 없으면 LLVM처럼 0이다.
const fenceSet = (bits: number): string =>
  bits === 0
    ? '0'
    : FENCE_BITS.filter((_, index) => (bits & (1 << (FENCE_BITS.length - 1 - index))) !== 0).join(
        '',
      );

const fence = (inst: number): string =>
  `fence ${fenceSet((inst >>> 24) & FENCE_FIELD_MASK)}, ${fenceSet((inst >>> 20) & FENCE_FIELD_MASK)}`;

const csrName = (id: number): string => CSR_NAMES.get(id) ?? hex(id);

const system = (inst: number, rd: number, funct3: number, rs1: number): string => {
  const named = SYSTEM_WORD.get(inst);
  if (named !== undefined) return named;
  if (funct3 === 0) {
    const funct7 = inst >>> 25;
    return funct7 === SFENCE_VMA_FUNCT7 && rd === 0
      ? `sfence.vma ${reg(rs1)}, ${reg((inst >>> 20) & 0x1f)}`
      : UNKNOWN;
  }
  const table = (funct3 & CSR_IMMEDIATE_BIT) !== 0 ? CSR_IMM : CSR_REG;
  const mnemonic = table[funct3 & CSR_OP_MASK];
  if (mnemonic === undefined) return UNKNOWN;
  const source = (funct3 & CSR_IMMEDIATE_BIT) !== 0 ? hex(rs1) : reg(rs1);
  return `${mnemonic} ${reg(rd)}, ${csrName(inst >>> 20)}, ${source}`;
};

const opImm = (inst: number, rd: number, funct3: number, rs1: number): string => {
  const mnemonic = ALU_IMM[funct3];
  if (mnemonic === undefined) return UNKNOWN;
  if (funct3 === FUNCT3_SLL || funct3 === FUNCT3_SHIFT_RIGHT) {
    const funct7 = inst >>> 25;
    const valid = funct7 === 0 || (funct3 === FUNCT3_SHIFT_RIGHT && funct7 === ALT_FUNCT7);
    if (!valid) return UNKNOWN;
    const name = funct7 === ALT_FUNCT7 ? 'srai' : mnemonic;
    return `${name} ${reg(rd)}, ${reg(rs1)}, ${hex((inst >>> 20) & 0x1f)}`;
  }
  return `${mnemonic} ${reg(rd)}, ${reg(rs1)}, ${hex(immI(inst))}`;
};

const op = (inst: number, rd: number, funct3: number, rs1: number): string => {
  const funct7 = inst >>> 25;
  const rs2 = reg((inst >>> 20) & 0x1f);
  let mnemonic: string | undefined;
  if (funct7 === MULDIV_FUNCT7) mnemonic = MULDIV[funct3];
  else if (funct7 === 0) mnemonic = ALU_REG[funct3];
  else if (funct7 === ALT_FUNCT7 && funct3 === FUNCT3_ADD) mnemonic = 'sub';
  else if (funct7 === ALT_FUNCT7 && funct3 === FUNCT3_SHIFT_RIGHT) mnemonic = 'sra';
  return mnemonic === undefined ? UNKNOWN : `${mnemonic} ${reg(rd)}, ${reg(rs1)}, ${rs2}`;
};

// word는 부호 없는 32비트 수, pc는 분기·jal의 절대 대상을 계산하는 데 쓴다.
export const disassemble = (word: number, pc: number): string => {
  const inst = word >>> 0;
  const rd = (inst >>> 7) & 0x1f;
  const funct3 = (inst >>> 12) & 0x7;
  const rs1 = (inst >>> 15) & 0x1f;
  const rs2 = (inst >>> 20) & 0x1f;

  switch (inst & 0x7f) {
    case OPCODE.lui:
      return `lui ${reg(rd)}, ${hex(inst >>> UPPER_20_SHIFT)}`;
    case OPCODE.auipc:
      return `auipc ${reg(rd)}, ${hex(inst >>> UPPER_20_SHIFT)}`;
    case OPCODE.jal:
      return `jal ${reg(rd)}, ${address(pc, immJ(inst))}`;
    case OPCODE.jalr:
      return funct3 === 0 ? `jalr ${reg(rd)}, ${hex(immI(inst))}(${reg(rs1)})` : UNKNOWN;
    case OPCODE.branch: {
      const mnemonic = BRANCH[funct3];
      return mnemonic === undefined
        ? UNKNOWN
        : `${mnemonic} ${reg(rs1)}, ${reg(rs2)}, ${address(pc, immB(inst))}`;
    }
    case OPCODE.load: {
      const mnemonic = LOAD[funct3];
      return mnemonic === undefined
        ? UNKNOWN
        : `${mnemonic} ${reg(rd)}, ${hex(immI(inst))}(${reg(rs1)})`;
    }
    case OPCODE.store: {
      const mnemonic = STORE[funct3];
      return mnemonic === undefined
        ? UNKNOWN
        : `${mnemonic} ${reg(rs2)}, ${hex(immS(inst))}(${reg(rs1)})`;
    }
    case OPCODE.opImm:
      return opImm(inst, rd, funct3, rs1);
    case OPCODE.op:
      return op(inst, rd, funct3, rs1);
    case OPCODE.miscMem:
      if (funct3 === FUNCT3_MISC_FENCE) return fence(inst);
      return funct3 === FUNCT3_MISC_FENCE_I ? 'fence.i' : UNKNOWN;
    case OPCODE.system:
      return system(inst, rd, funct3, rs1);
    default:
      return UNKNOWN;
  }
};
