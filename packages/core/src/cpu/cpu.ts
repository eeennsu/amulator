import { BusFault, type AccessKind, type AccessWidth, type Bus } from '../bus';
import { RAM_BASE } from '../memoryMap';
import {
  CsrFile,
  MIP_MEIP,
  MIP_MSIP,
  MIP_MTIP,
  MSTATUS_MIE,
  PRIVILEGE,
  type Privilege,
} from './csr';

export { PRIVILEGE, type Privilege };

export const REGISTER_COUNT = 32;
const INSTRUCTION_BYTES = 4;
const SHIFT_MASK = 0x1f;
const UPPER_20_MASK = 0xffff_f000;
const SIGN_BIT = 0x8000_0000;
const LIMB_BITS = 16;
const LIMB_MASK = 0xffff;
const LIMB_RANGE = 0x1_0000;
const ALL_ONES = 0xffff_ffff;
const ALT_FUNCT7 = 0x20; // sub, sra, srai
const MULDIV_FUNCT7 = 0x01;

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

// op와 opImm이 funct3를 공유한다.
const ALU = { add: 0, sll: 1, slt: 2, sltu: 3, xor: 4, shr: 5, or: 6, and: 7 } as const;
const MULDIV = { mul: 0, mulh: 1, mulhsu: 2, mulhu: 3, div: 4, divu: 5, rem: 6, remu: 7 } as const;
const BRANCH = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 } as const;
const LOAD = { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 } as const;
const STORE = { sb: 0, sh: 1, sw: 2 } as const;
const MISC_MEM = { fence: 0, fenceI: 1 } as const;

// funct3가 0인 SYSTEM 명령어는 워드 전체가 정해져 있다. S 모드가 없어 sret·sfence.vma는 illegal이다.
const SYSTEM_WORD = {
  ecall: 0x0000_0073,
  ebreak: 0x0010_0073,
  mret: 0x3020_0073,
  wfi: 0x1050_0073,
} as const;
const CSR_OP = { write: 1, set: 2, clear: 3 } as const;
const CSR_OP_MASK = 0x3;
const CSR_IMMEDIATE_BIT = 0x4; // csrrwi·csrrsi·csrrci

const CAUSE = {
  instructionMisaligned: 0,
  instructionAccessFault: 1,
  illegalInstruction: 2,
  breakpoint: 3,
  loadAccessFault: 5,
  storeAccessFault: 7,
  ecallFromUser: 8,
  ecallFromMachine: 11,
} as const;
const ACCESS_FAULT_CAUSE = {
  fetch: CAUSE.instructionAccessFault,
  read: CAUSE.loadAccessFault,
  write: CAUSE.storeAccessFault,
} as const satisfies Record<AccessKind, number>;

const INTERRUPT_FLAG = 0x8000_0000;
// 우선순위 순서다: MEI > MSI > MTI
const INTERRUPTS = [
  { bit: MIP_MEIP, code: 11 },
  { bit: MIP_MSIP, code: 3 },
  { bit: MIP_MTIP, code: 7 },
] as const;

// 즉시값은 부호 있는 수로 돌려준다. inst는 부호 없는 32비트 수다.
const immI = (inst: number): number => inst >> 20;
const immS = (inst: number): number => ((inst >> 25) << 5) | ((inst >>> 7) & 0x1f);
const immB = (inst: number): number =>
  ((inst >> 31) << 12) | ((inst & 0x80) << 4) | ((inst >>> 20) & 0x7e0) | ((inst >>> 7) & 0x1e);
const immJ = (inst: number): number =>
  ((inst >> 31) << 20) | (inst & 0xff000) | ((inst >>> 9) & 0x800) | ((inst >>> 20) & 0x7fe);

// C 확장이 없어 명령어는 4바이트 경계에만 놓인다.
const isMisaligned = (target: number): boolean => (target & (INSTRUCTION_BYTES - 1)) !== 0;

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

// 부호 없는 두 수의 곱에서 상위 32비트. BigInt 없이 16비트 조각으로 나눠 곱한다.
const mulhu = (a: number, b: number): number => {
  const aLow = a & LIMB_MASK;
  const aHigh = a >>> LIMB_BITS;
  const bLow = b & LIMB_MASK;
  const bHigh = b >>> LIMB_BITS;
  // 조각 곱은 2^32 미만이고 middle은 2^33 미만이라 double에서 정확하다
  const middle = aHigh * bLow + aLow * bHigh + ((aLow * bLow) >>> LIMB_BITS);
  return aHigh * bHigh + Math.floor(middle / LIMB_RANGE);
};

// 결과는 음수일 수 있다. 레지스터에 쓸 때 Uint32Array가 감는다.
// 부호 있는 곱의 상위 워드는 부호 없는 곱의 상위 워드에서 (a < 0 ? b : 0)과 (b < 0 ? a : 0)을 뺀 값이다.
const mulDiv = (funct3: number, a: number, b: number): number => {
  switch (funct3) {
    case MULDIV.mul:
      return Math.imul(a, b);
    case MULDIV.mulh:
      return mulhu(a, b) - (a >= SIGN_BIT ? b : 0) - (b >= SIGN_BIT ? a : 0);
    case MULDIV.mulhsu:
      return mulhu(a, b) - (a >= SIGN_BIT ? b : 0);
    case MULDIV.mulhu:
      return mulhu(a, b);
    // -2^31 / -1은 나눗셈이 2^31을 내고 `| 0`이 -2^31로 감아 스펙의 결과와 같다. rem은 -0이 0이 된다.
    case MULDIV.div:
      return b === 0 ? ALL_ONES : ((a | 0) / (b | 0)) | 0;
    case MULDIV.divu:
      return b === 0 ? ALL_ONES : Math.floor(a / b);
    case MULDIV.rem:
      return b === 0 ? a : ((a | 0) % (b | 0)) | 0;
    default:
      return b === 0 ? a : a % b;
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

const csrUpdate = (op: number, old: number, operand: number): number => {
  switch (op) {
    case CSR_OP.write:
      return operand;
    case CSR_OP.set:
      return old | operand;
    default:
      return old & ~operand;
  }
};

export class Cpu {
  readonly x = new Uint32Array(REGISTER_COUNT);
  pc = RAM_BASE;
  privilege: Privilege = PRIVILEGE.machine;
  idle = false; // wfi로 쉬는 중
  private readonly csr: CsrFile;

  // readTime은 time·timeh CSR의 값이다(64비트를 number로, 2^53 이하).
  constructor(
    private readonly bus: Bus,
    readTime: () => number,
  ) {
    this.csr = new CsrFile(readTime);
  }

  private reg = (index: number): number => this.x[index] ?? 0;

  // x0은 쓰지 않아 항상 0이다.
  private setReg = (index: number, value: number): void => {
    if (index !== 0) this.x[index] = value;
  };

  // 테스트와 스냅샷용이라 권한을 검사하지 않는다. 없는 CSR 번호는 던진다.
  readCsr = (address: number): number => {
    const value = this.csr.read(address);
    if (value === undefined) throw new RangeError(`없는 CSR 0x${address.toString(16)}`);
    return value;
  };

  writeCsr = (address: number, value: number): void => {
    this.readCsr(address); // 번호 검사
    this.csr.write(address, value);
  };

  // MTIP·MSIP·MEIP는 mip에서 소프트웨어가 못 쓰는 비트라 장치가 이 메서드로만 바꾼다.
  setInterruptPending = (bit: number, pending: boolean): void => {
    this.csr.mip = pending ? this.csr.mip | bit : this.csr.mip & ~bit;
  };

  private trap = (cause: number, tval: number): void => {
    this.csr.enterTrap(this.privilege, this.pc, cause, tval);
    this.privilege = PRIVILEGE.machine;
    this.pc = this.csr.mtvec;
  };

  private illegal = (inst: number): void => {
    this.trap(CAUSE.illegalInstruction, inst);
  };

  // 켜진 인터럽트가 걸려 있으면 트랩으로 들어가고 true를 돌려준다.
  private takeInterrupt = (): boolean => {
    const { csr } = this;
    const pending = csr.mip & csr.mie;
    if (pending === 0) return false;
    // M 모드에서만 MIE가 막고, 낮은 권한에서는 MIE와 무관하게 늘 켜져 있다
    if (this.privilege === PRIVILEGE.machine && (csr.mstatus & MSTATUS_MIE) === 0) return false;
    for (const { bit, code } of INTERRUPTS) {
      if ((pending & bit) !== 0) {
        this.trap((INTERRUPT_FLAG | code) >>> 0, 0);
        return true;
      }
    }
    return false;
  };

  step = (): void => {
    if (this.idle) {
      // 깨우는 데는 전역 MIE가 필요 없다
      if ((this.csr.mip & this.csr.mie) === 0) return;
      this.idle = false;
    }
    if (this.takeInterrupt()) return;
    try {
      this.execute();
    } catch (error) {
      if (!(error instanceof BusFault)) throw error;
      this.trap(ACCESS_FAULT_CAUSE[error.access], error.address);
    }
  };

  // 트랩하면 pc는 핸들러로 가 있고 명령어는 퇴직하지 않는다.
  private execute = (): void => {
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
      case OPCODE.jal: {
        const target = (pc + immJ(inst)) >>> 0;
        if (isMisaligned(target)) return this.trap(CAUSE.instructionMisaligned, target);
        this.setReg(rd, next);
        next = target;
        break;
      }
      case OPCODE.jalr: {
        if (funct3 !== 0) return this.illegal(inst);
        const target = ((a + immI(inst)) & ~1) >>> 0;
        if (isMisaligned(target)) return this.trap(CAUSE.instructionMisaligned, target);
        this.setReg(rd, next);
        next = target;
        break;
      }
      case OPCODE.branch: {
        const taken = isTaken(funct3, a, b);
        if (taken === undefined) return this.illegal(inst);
        if (taken) {
          const target = (pc + immB(inst)) >>> 0;
          if (isMisaligned(target)) return this.trap(CAUSE.instructionMisaligned, target);
          next = target;
        }
        break;
      }
      case OPCODE.load: {
        const value = load(bus, funct3, (a + immI(inst)) >>> 0);
        if (value === undefined) return this.illegal(inst);
        this.setReg(rd, value);
        break;
      }
      case OPCODE.store: {
        const width = storeWidth(funct3);
        if (width === undefined) return this.illegal(inst);
        bus.write((a + immS(inst)) >>> 0, width, b);
        break;
      }
      case OPCODE.opImm: {
        const shift = funct3 === ALU.sll || funct3 === ALU.shr;
        const alt = shift && funct7 === ALT_FUNCT7;
        if (shift && funct7 !== 0 && !(alt && funct3 === ALU.shr)) return this.illegal(inst);
        this.setReg(rd, alu(funct3, alt, a, immI(inst)));
        break;
      }
      case OPCODE.op: {
        if (funct7 === MULDIV_FUNCT7) {
          this.setReg(rd, mulDiv(funct3, a, b));
          break;
        }
        const alt = funct7 === ALT_FUNCT7;
        if (funct7 !== 0 && !(alt && (funct3 === ALU.add || funct3 === ALU.shr))) {
          return this.illegal(inst);
        }
        this.setReg(rd, alu(funct3, alt, a, b));
        break;
      }
      case OPCODE.miscMem:
        // 순서대로 하나씩 실행하고 명령어 캐시가 없어 fence와 fence.i는 할 일이 없다.
        if (funct3 !== MISC_MEM.fence && funct3 !== MISC_MEM.fenceI) return this.illegal(inst);
        break;
      case OPCODE.system:
        if (funct3 !== 0) {
          if (!this.csrInstruction(inst, rd, funct3, a)) return this.illegal(inst);
          break;
        }
        switch (inst) {
          case SYSTEM_WORD.ecall:
            return this.trap(
              this.privilege === PRIVILEGE.machine ? CAUSE.ecallFromMachine : CAUSE.ecallFromUser,
              0,
            );
          case SYSTEM_WORD.ebreak:
            return this.trap(CAUSE.breakpoint, pc);
          case SYSTEM_WORD.mret:
            if (this.privilege !== PRIVILEGE.machine) return this.illegal(inst);
            this.privilege = this.csr.exitTrap();
            next = this.csr.mepc;
            break;
          case SYSTEM_WORD.wfi:
            this.idle = true;
            break;
          default:
            return this.illegal(inst);
        }
        break;
      default:
        return this.illegal(inst);
    }

    this.pc = next;
    this.csr.retire();
  };

  // 접근할 수 없는 CSR이면 false를 돌려주고, 아무것도 바꾸지 않는다.
  private csrInstruction = (
    inst: number,
    rd: number,
    funct3: number,
    rs1Value: number,
  ): boolean => {
    const { csr } = this;
    const op = funct3 & CSR_OP_MASK;
    if (op === 0) return false;
    const address = inst >>> 20;
    const source = (inst >>> 15) & 0x1f; // rs1 번호 또는 uimm
    // csrrs·csrrc는 rs1 = x0(uimm = 0)이면 읽기만 한다
    const write = op === CSR_OP.write || source !== 0;
    if (!csr.canAccess(address, this.privilege, write)) return false;
    const old = csr.read(address);
    if (old === undefined) return false;
    if (write) {
      const operand = (funct3 & CSR_IMMEDIATE_BIT) !== 0 ? source : rs1Value;
      csr.write(address, csrUpdate(op, old, operand));
      csr.holdCounter(address);
    }
    this.setReg(rd, old);
    return true;
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
