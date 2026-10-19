// RV32 명령어 인코더. 음수 즉시값은 하위 비트만 잘라 쓴다. 결과는 부호 없는 32비트 수다.
const OP = 0x33;
const OP_IMM = 0x13;
const LOAD = 0x03;
const STORE = 0x23;
const BRANCH = 0x63;
const LUI = 0x37;
const AUIPC = 0x17;
const JAL = 0x6f;
const JALR = 0x67;
const MISC_MEM = 0x0f;
const SYSTEM = 0x73;

const ALT_FUNCT7 = 0x20; // sub, sra, srai
const MULDIV_FUNCT7 = 0x01;
const SRAI_BIT = ALT_FUNCT7 << 5; // srai는 즉시값 상위 7비트(imm[11:5])에 funct7을 둔다

export const encodeR = (
  opcode: number,
  funct3: number,
  funct7: number,
  rd: number,
  rs1: number,
  rs2: number,
): number =>
  ((funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode) >>> 0;

export const encodeI = (
  opcode: number,
  funct3: number,
  rd: number,
  rs1: number,
  imm: number,
): number => (((imm & 0xfff) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode) >>> 0;

export const encodeS = (
  opcode: number,
  funct3: number,
  rs1: number,
  rs2: number,
  imm: number,
): number =>
  ((((imm >> 5) & 0x7f) << 25) |
    (rs2 << 20) |
    (rs1 << 15) |
    (funct3 << 12) |
    ((imm & 0x1f) << 7) |
    opcode) >>>
  0;

// imm은 바이트 오프셋이고 0번 비트는 쓰지 않는다.
export const encodeB = (
  opcode: number,
  funct3: number,
  rs1: number,
  rs2: number,
  imm: number,
): number =>
  ((((imm >> 12) & 1) << 31) |
    (((imm >> 5) & 0x3f) << 25) |
    (rs2 << 20) |
    (rs1 << 15) |
    (funct3 << 12) |
    (((imm >> 1) & 0xf) << 8) |
    (((imm >> 11) & 1) << 7) |
    opcode) >>>
  0;

// imm20은 상위 20비트 값 자체다(lui x1, 0x12345의 0x12345).
export const encodeU = (opcode: number, rd: number, imm20: number): number =>
  (((imm20 & 0xf_ffff) << 12) | (rd << 7) | opcode) >>> 0;

// imm은 바이트 오프셋이고 0번 비트는 쓰지 않는다.
export const encodeJ = (opcode: number, rd: number, imm: number): number =>
  ((((imm >> 20) & 1) << 31) |
    (((imm >> 1) & 0x3ff) << 21) |
    (((imm >> 11) & 1) << 20) |
    (((imm >> 12) & 0xff) << 12) |
    (rd << 7) |
    opcode) >>>
  0;

const regOp =
  (funct3: number, funct7 = 0) =>
  (rd: number, rs1: number, rs2: number): number =>
    encodeR(OP, funct3, funct7, rd, rs1, rs2);
const immOp =
  (funct3: number) =>
  (rd: number, rs1: number, value: number): number =>
    encodeI(OP_IMM, funct3, rd, rs1, value);
const csrOp =
  (funct3: number) =>
  (rd: number, csr: number, source: number): number =>
    encodeI(SYSTEM, funct3, rd, source, csr);
const loadOp =
  (funct3: number) =>
  (rd: number, rs1: number, offset: number): number =>
    encodeI(LOAD, funct3, rd, rs1, offset);
const storeOp =
  (funct3: number) =>
  (rs2: number, rs1: number, offset: number): number =>
    encodeS(STORE, funct3, rs1, rs2, offset);
const branchOp =
  (funct3: number) =>
  (rs1: number, rs2: number, offset: number): number =>
    encodeB(BRANCH, funct3, rs1, rs2, offset);

export const add = regOp(0);
export const sub = regOp(0, ALT_FUNCT7);
export const sll = regOp(1);
export const slt = regOp(2);
export const sltu = regOp(3);
export const xor = regOp(4);
export const srl = regOp(5);
export const sra = regOp(5, ALT_FUNCT7);
export const or = regOp(6);
export const and = regOp(7);

export const mul = regOp(0, MULDIV_FUNCT7);
export const mulh = regOp(1, MULDIV_FUNCT7);
export const mulhsu = regOp(2, MULDIV_FUNCT7);
export const mulhu = regOp(3, MULDIV_FUNCT7);
export const div = regOp(4, MULDIV_FUNCT7);
export const divu = regOp(5, MULDIV_FUNCT7);
export const rem = regOp(6, MULDIV_FUNCT7);
export const remu = regOp(7, MULDIV_FUNCT7);

export const addi = immOp(0);
export const slti = immOp(2);
export const sltiu = immOp(3);
export const xori = immOp(4);
export const ori = immOp(6);
export const andi = immOp(7);
export const slli = immOp(1);
export const srli = immOp(5);
export const srai = (rd: number, rs1: number, shamt: number): number =>
  encodeI(OP_IMM, 5, rd, rs1, shamt | SRAI_BIT);

export const lb = loadOp(0);
export const lh = loadOp(1);
export const lw = loadOp(2);
export const lbu = loadOp(4);
export const lhu = loadOp(5);

// 인자 순서는 어셈블리와 같다: sw rs2, offset(rs1)
export const sb = storeOp(0);
export const sh = storeOp(1);
export const sw = storeOp(2);

export const beq = branchOp(0);
export const bne = branchOp(1);
export const blt = branchOp(4);
export const bge = branchOp(5);
export const bltu = branchOp(6);
export const bgeu = branchOp(7);

export const lui = (rd: number, imm20: number): number => encodeU(LUI, rd, imm20);
export const auipc = (rd: number, imm20: number): number => encodeU(AUIPC, rd, imm20);
export const jal = (rd: number, offset: number): number => encodeJ(JAL, rd, offset);
export const jalr = (rd: number, rs1: number, offset: number): number =>
  encodeI(JALR, 0, rd, rs1, offset);

// 인자 순서는 어셈블리와 같다: csrrw rd, csr, rs1. 즉시값 형(csrrwi 등)은 마지막 인자가 5비트 uimm이다.
export const csrrw = csrOp(1);
export const csrrs = csrOp(2);
export const csrrc = csrOp(3);
export const csrrwi = csrOp(5);
export const csrrsi = csrOp(6);
export const csrrci = csrOp(7);
export const csrr = (rd: number, csr: number): number => csrrs(rd, csr, 0);

export const ecall = (): number => encodeI(SYSTEM, 0, 0, 0, 0x000);
export const ebreak = (): number => encodeI(SYSTEM, 0, 0, 0, 0x001);
export const mret = (): number => encodeI(SYSTEM, 0, 0, 0, 0x302);
export const wfi = (): number => encodeI(SYSTEM, 0, 0, 0, 0x105);

// pred=succ=iorw인 일반 fence
export const fence = (): number => encodeI(MISC_MEM, 0, 0, 0, 0x0ff);
export const fenceI = (): number => encodeI(MISC_MEM, 1, 0, 0, 0);
