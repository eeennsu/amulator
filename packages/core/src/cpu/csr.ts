export const PRIVILEGE = { user: 0, machine: 3 } as const;
export type Privilege = (typeof PRIVILEGE)[keyof typeof PRIVILEGE];

export const CSR = {
  mstatus: 0x300,
  misa: 0x301,
  mie: 0x304,
  mtvec: 0x305,
  mcounteren: 0x306,
  mscratch: 0x340,
  mepc: 0x341,
  mcause: 0x342,
  mtval: 0x343,
  mip: 0x344,
  pmpcfg0: 0x3a0,
  pmpcfg3: 0x3a3,
  pmpaddr0: 0x3b0,
  pmpaddr15: 0x3bf,
  mcycle: 0xb00,
  minstret: 0xb02,
  mcycleh: 0xb80,
  minstreth: 0xb82,
  cycle: 0xc00,
  time: 0xc01,
  instret: 0xc02,
  cycleh: 0xc80,
  timeh: 0xc81,
  instreth: 0xc82,
  mvendorid: 0xf11,
  marchid: 0xf12,
  mimpid: 0xf13,
  mhartid: 0xf14,
} as const;

export const MSTATUS_MIE = 1 << 3;
export const MSTATUS_MPIE = 1 << 7;
export const MSTATUS_MPP = 3 << 11;
export const MIP_MSIP = 1 << 3;
export const MIP_MTIP = 1 << 7;
export const MIP_MEIP = 1 << 11;

// RV32(MXL=1)에 I·M·U 확장.
export const MISA_VALUE = 0x4010_1100;

const MPP_SHIFT = 11;
const INTERRUPT_BITS = MIP_MSIP | MIP_MTIP | MIP_MEIP;
const COUNTEREN_CY = 1 << 0;
const COUNTEREN_TM = 1 << 1;
const COUNTEREN_IR = 1 << 2;
const COUNTEREN_BITS = COUNTEREN_CY | COUNTEREN_TM | COUNTEREN_IR;
const UINT32_RANGE = 0x1_0000_0000;
const ADDRESS_LEVEL_SHIFT = 8; // CSR 주소 [9:8]이 접근에 필요한 최소 권한이다
const ADDRESS_READ_ONLY_SHIFT = 10; // [11:10]이 3이면 읽기 전용이다
const FIELD_MASK = 0x3;

// 64비트 카운터의 하위·상위 워드. 쓰기가 낀 명령어는 자기 증가를 한 번 건너뛴다.
export class Counter {
  lo = 0;
  hi = 0;
  private held = false;

  hold = (): void => {
    this.held = true;
  };

  tick = (): void => {
    if (this.held) {
      this.held = false;
      return;
    }
    this.lo = (this.lo + 1) >>> 0;
    if (this.lo === 0) this.hi = (this.hi + 1) >>> 0;
  };
}

// 사용자 모드 shadow 카운터를 열어 주는 mcounteren 비트. 그 밖의 CSR은 0이다.
const counterEnableBit = (address: number): number => {
  switch (address) {
    case CSR.cycle:
    case CSR.cycleh:
      return COUNTEREN_CY;
    case CSR.time:
    case CSR.timeh:
      return COUNTEREN_TM;
    case CSR.instret:
    case CSR.instreth:
      return COUNTEREN_IR;
    default:
      return 0;
  }
};

// PMP 엔트리가 0개라 pmpcfg·pmpaddr는 0을 읽고 쓰기를 무시한다.
const isPmp = (address: number): boolean =>
  (address >= CSR.pmpcfg0 && address <= CSR.pmpcfg3) ||
  (address >= CSR.pmpaddr0 && address <= CSR.pmpaddr15);

export class CsrFile {
  mstatus = 0;
  mie = 0;
  mip = 0;
  mtvec = 0;
  mcounteren = 0;
  mscratch = 0;
  mepc = 0;
  mcause = 0;
  mtval = 0;
  readonly cycle = new Counter();
  readonly instret = new Counter();

  constructor(private readonly readTime: () => number) {}

  // 권한 검사 없이 읽는다. 없는 CSR이면 undefined다.
  read = (address: number): number | undefined => {
    if (isPmp(address)) return 0;
    switch (address) {
      case CSR.mstatus:
        return this.mstatus;
      case CSR.misa:
        return MISA_VALUE;
      case CSR.mie:
        return this.mie;
      case CSR.mtvec:
        return this.mtvec;
      case CSR.mcounteren:
        return this.mcounteren;
      case CSR.mscratch:
        return this.mscratch;
      case CSR.mepc:
        return this.mepc;
      case CSR.mcause:
        return this.mcause;
      case CSR.mtval:
        return this.mtval;
      case CSR.mip:
        return this.mip;
      case CSR.mcycle:
      case CSR.cycle:
        return this.cycle.lo;
      case CSR.mcycleh:
      case CSR.cycleh:
        return this.cycle.hi;
      case CSR.minstret:
      case CSR.instret:
        return this.instret.lo;
      case CSR.minstreth:
      case CSR.instreth:
        return this.instret.hi;
      case CSR.time:
        return this.readTime() >>> 0; // 2^53 이하의 정수라 ToUint32가 하위 32비트를 돌려준다
      case CSR.timeh:
        return Math.floor(this.readTime() / UINT32_RANGE) >>> 0;
      case CSR.mvendorid:
      case CSR.marchid:
      case CSR.mimpid:
      case CSR.mhartid:
        return 0;
      default:
        return undefined;
    }
  };

  // 권한 검사 없이 쓴다. 쓸 수 없는 비트와 읽기 전용·없는 CSR은 무시한다.
  write = (address: number, rawValue: number): void => {
    const value = rawValue >>> 0;
    switch (address) {
      case CSR.mstatus: {
        const mpp = value & MSTATUS_MPP;
        // MPP는 U(0)와 M(3)만 받는다
        this.mstatus = (value & (MSTATUS_MIE | MSTATUS_MPIE)) | (mpp === MSTATUS_MPP ? mpp : 0);
        break;
      }
      case CSR.mie:
        this.mie = value & INTERRUPT_BITS;
        break;
      case CSR.mtvec: // direct 모드만 지원해 MODE 비트를 0으로 고정한다
        this.mtvec = (value & ~FIELD_MASK) >>> 0;
        break;
      case CSR.mcounteren:
        this.mcounteren = value & COUNTEREN_BITS;
        break;
      case CSR.mscratch:
        this.mscratch = value;
        break;
      case CSR.mepc: // C 확장이 없어 하위 2비트는 0이다
        this.mepc = (value & ~FIELD_MASK) >>> 0;
        break;
      case CSR.mcause:
        this.mcause = value;
        break;
      case CSR.mtval:
        this.mtval = value;
        break;
      case CSR.mcycle:
        this.cycle.lo = value;
        break;
      case CSR.mcycleh:
        this.cycle.hi = value;
        break;
      case CSR.minstret:
        this.instret.lo = value;
        break;
      case CSR.minstreth:
        this.instret.hi = value;
        break;
      default:
        break;
    }
  };

  // CSR 명령어의 접근 권한: 최소 권한, 읽기 전용 CSR에 쓰기, U 모드의 shadow 카운터와 mcounteren.
  canAccess = (address: number, privilege: Privilege, write: boolean): boolean => {
    if (privilege < ((address >>> ADDRESS_LEVEL_SHIFT) & FIELD_MASK)) return false;
    if (write && address >>> ADDRESS_READ_ONLY_SHIFT === FIELD_MASK) return false;
    const enableBit = counterEnableBit(address);
    return (
      privilege === PRIVILEGE.machine || enableBit === 0 || (this.mcounteren & enableBit) !== 0
    );
  };

  // minstret·mcycle을 쓴 명령어는 쓴 값을 자기 증가가 덮지 않게 한다(riscv-tests instret_overflow).
  holdCounter = (address: number): void => {
    if (address === CSR.mcycle || address === CSR.mcycleh) this.cycle.hold();
    else if (address === CSR.minstret || address === CSR.minstreth) this.instret.hold();
  };

  // 한 클럭에 한 명령어라 mcycle도 같이 센다.
  retire = (): void => {
    this.cycle.tick();
    this.instret.tick();
  };

  // mepc·mcause·mtval을 채우고 MPIE ← MIE, MIE ← 0, MPP ← 트랩 전 권한으로 바꾼다.
  enterTrap = (privilege: Privilege, pc: number, cause: number, tval: number): void => {
    this.mepc = pc;
    this.mcause = cause;
    this.mtval = tval;
    const mpie = (this.mstatus & MSTATUS_MIE) !== 0 ? MSTATUS_MPIE : 0;
    this.mstatus =
      (this.mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP)) |
      mpie |
      (privilege << MPP_SHIFT);
  };

  // MIE ← MPIE, MPIE ← 1, MPP ← U로 바꾸고 복귀할 권한을 돌려준다.
  exitTrap = (): Privilege => {
    const { mstatus } = this;
    const mie = (mstatus & MSTATUS_MPIE) !== 0 ? MSTATUS_MIE : 0;
    this.mstatus = (mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP)) | mie | MSTATUS_MPIE;
    return (mstatus & MSTATUS_MPP) === MSTATUS_MPP ? PRIVILEGE.machine : PRIVILEGE.user;
  };
}
