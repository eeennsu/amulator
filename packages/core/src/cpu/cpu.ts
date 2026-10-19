import type { AccessWidth, Bus } from '../bus';
import { RAM_BASE } from '../memoryMap';

export const PRIVILEGE = { user: 0, machine: 3 } as const;
export type Privilege = (typeof PRIVILEGE)[keyof typeof PRIVILEGE];

const REGISTER_COUNT = 32;
const INSTRUCTION_BYTES = 4;
const SHIFT_MASK = 0x1f;
const UPPER_20_MASK = 0xffff_f000;
const ALT_FUNCT7 = 0x20; // sub, sra, srai

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
} as const;

// op와 opImm이 funct3를 공유한다.
const ALU = { add: 0, sll: 1, slt: 2, sltu: 3, xor: 4, shr: 5, or: 6, and: 7 } as const;
const BRANCH = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 } as const;
const LOAD = { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 } as const;
const STORE = { sb: 0, sh: 1, sw: 2 } as const;
const MISC_MEM = { fence: 0, fenceI: 1 } as const;

// 즉시값은 부호 있는 수로 돌려준다. inst는 부호 없는 32비트 수다.
const immI = (inst: number): number => inst >> 20;
const immS = (inst: number): number => ((inst >> 25) << 5) | ((inst >>> 7) & 0x1f);
const immB = (inst: number): number =>
  ((inst >> 31) << 12) | ((inst & 0x80) << 4) | ((inst >>> 20) & 0x7e0) | ((inst >>> 7) & 0x1e);
const immJ = (inst: number): number =>
  ((inst >> 31) << 20) | (inst & 0xff000) | ((inst >>> 9) & 0x800) | ((inst >>> 20) & 0x7fe);

// 결과는 32비트를 넘거나 음수일 수 있다. 레지스터에 쓸 때 Uint32Array가 감는다.
const alu = (funct3: number, alt: boolean, a: number, b: number): number => {
  switch (funct3) {
    case ALU.add:
      return alt ? a - b : a + b;
    case ALU.sll:
      return a << (b & SHIFT_MASK);
    case ALU.slt:
      return (a | 0) < (b | 0) ? 1 : 0;
    case ALU.sltu:
      return a < b >>> 0 ? 1 : 0; // sltiu의 b는 부호 확장된 음수일 수 있다
    case ALU.xor:
      return a ^ b;
    case ALU.shr:
      return alt ? (a | 0) >> (b & SHIFT_MASK) : a >>> (b & SHIFT_MASK);
    case ALU.or:
      return a | b;
    default:
      return a & b;
  }
};

const isTaken = (funct3: number, a: number, b: number): boolean | undefined => {
  switch (funct3) {
    case BRANCH.beq:
      return a === b;
    case BRANCH.bne:
      return a !== b;
    case BRANCH.blt:
      return (a | 0) < (b | 0);
    case BRANCH.bge:
      return (a | 0) >= (b | 0);
    case BRANCH.bltu:
      return a < b;
    case BRANCH.bgeu:
      return a >= b;
    default:
      return undefined;
  }
};

const load = (bus: Bus, funct3: number, address: number): number | undefined => {
  switch (funct3) {
    case LOAD.lb:
      return (bus.read(address, 1) << 24) >> 24;
    case LOAD.lh:
      return (bus.read(address, 2) << 16) >> 16;
    case LOAD.lw:
      return bus.read(address, 4);
    case LOAD.lbu:
      return bus.read(address, 1);
    case LOAD.lhu:
      return bus.read(address, 2);
    default:
      return undefined;
  }
};

const storeWidth = (funct3: number): AccessWidth | undefined => {
  switch (funct3) {
    case STORE.sb:
      return 1;
    case STORE.sh:
      return 2;
    case STORE.sw:
      return 4;
    default:
      return undefined;
  }
};

// shortcut: 알 수 없는 명령어는 Error로 던진다, Task 6에서 illegal instruction 트랩으로 바꾼다.
const illegalInstruction = (inst: number, pc: number): Error =>
  new Error(`알 수 없는 명령어 0x${inst.toString(16)} (pc 0x${pc.toString(16)})`);

export class Cpu {
  readonly x = new Uint32Array(REGISTER_COUNT);
  pc = RAM_BASE;
  privilege: Privilege = PRIVILEGE.machine;

  constructor(private readonly bus: Bus) {}

  private reg = (index: number): number => this.x[index] ?? 0;

  // x0은 쓰지 않아 항상 0이다.
  private setReg = (index: number, value: number): void => {
    if (index !== 0) this.x[index] = value;
  };

  step = (): void => {
    const { bus, pc } = this;
    const inst = bus.fetch(pc);
    const rd = (inst >>> 7) & 0x1f;
    const funct3 = (inst >>> 12) & 0x7;
    const funct7 = inst >>> 25;
    const a = this.reg((inst >>> 15) & 0x1f);
    const b = this.reg((inst >>> 20) & 0x1f);
    let next = (pc + INSTRUCTION_BYTES) >>> 0;

    switch (inst & 0x7f) {
      case OPCODE.lui:
        this.setReg(rd, inst & UPPER_20_MASK);
        break;
      case OPCODE.auipc:
        this.setReg(rd, pc + (inst & UPPER_20_MASK));
        break;
      case OPCODE.jal:
        this.setReg(rd, next);
        next = (pc + immJ(inst)) >>> 0;
        break;
      case OPCODE.jalr:
        if (funct3 !== 0) throw illegalInstruction(inst, pc);
        this.setReg(rd, next);
        next = ((a + immI(inst)) & ~1) >>> 0;
        break;
      case OPCODE.branch: {
        const taken = isTaken(funct3, a, b);
        if (taken === undefined) throw illegalInstruction(inst, pc);
        if (taken) next = (pc + immB(inst)) >>> 0;
        break;
      }
      case OPCODE.load: {
        const value = load(bus, funct3, (a + immI(inst)) >>> 0);
        if (value === undefined) throw illegalInstruction(inst, pc);
        this.setReg(rd, value);
        break;
      }
      case OPCODE.store: {
        const width = storeWidth(funct3);
        if (width === undefined) throw illegalInstruction(inst, pc);
        bus.write((a + immS(inst)) >>> 0, width, b);
        break;
      }
      case OPCODE.opImm: {
        const shift = funct3 === ALU.sll || funct3 === ALU.shr;
        const alt = shift && funct7 === ALT_FUNCT7;
        if (shift && funct7 !== 0 && !(alt && funct3 === ALU.shr)) {
          throw illegalInstruction(inst, pc);
        }
        this.setReg(rd, alu(funct3, alt, a, immI(inst)));
        break;
      }
      case OPCODE.op: {
        const alt = funct7 === ALT_FUNCT7;
        if (funct7 !== 0 && !(alt && (funct3 === ALU.add || funct3 === ALU.shr))) {
          throw illegalInstruction(inst, pc);
        }
        this.setReg(rd, alu(funct3, alt, a, b));
        break;
      }
      case OPCODE.miscMem:
        // 순서대로 하나씩 실행하고 명령어 캐시가 없어 fence와 fence.i는 할 일이 없다.
        if (funct3 !== MISC_MEM.fence && funct3 !== MISC_MEM.fenceI) {
          throw illegalInstruction(inst, pc);
        }
        break;
      default:
        throw illegalInstruction(inst, pc);
    }

    this.pc = next;
  };

  run = (maxInstructions: number): number => {
    let count = 0;
    while (count < maxInstructions) {
      this.step();
      count += 1;
    }
    return count;
  };
}
