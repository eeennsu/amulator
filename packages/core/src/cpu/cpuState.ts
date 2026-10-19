import { z } from 'zod';

import { PRIVILEGE, REGISTER_COUNT, type Cpu } from './cpu';
import { CSR, MIP_MEIP, MIP_MSIP, MIP_MTIP } from './csr';

// 카운터는 64비트라 하위·상위 CSR을 따로 담는다.
export const cpuStateSchema = z.object({
  x: z
    .array(z.uint32())
    .length(REGISTER_COUNT)
    .refine((x) => x[0] === 0, 'x0은 0이어야 한다'),
  pc: z.uint32(),
  privilege: z.literal([PRIVILEGE.user, PRIVILEGE.machine]),
  idle: z.boolean(),
  mstatus: z.uint32(),
  mtvec: z.uint32(),
  mepc: z.uint32(),
  mcause: z.uint32(),
  mtval: z.uint32(),
  mie: z.uint32(),
  mip: z.uint32(),
  mscratch: z.uint32(),
  mcounteren: z.uint32(),
  mcycle: z.uint32(),
  mcycleh: z.uint32(),
  minstret: z.uint32(),
  minstreth: z.uint32(),
});

export type CpuState = z.infer<typeof cpuStateSchema>;

const INTERRUPT_BITS = [MIP_MSIP, MIP_MTIP, MIP_MEIP] as const;

export const saveCpuState = (cpu: Cpu): CpuState => ({
  x: Array.from(cpu.x),
  pc: cpu.pc,
  privilege: cpu.privilege,
  idle: cpu.idle,
  mstatus: cpu.readCsr(CSR.mstatus),
  mtvec: cpu.readCsr(CSR.mtvec),
  mepc: cpu.readCsr(CSR.mepc),
  mcause: cpu.readCsr(CSR.mcause),
  mtval: cpu.readCsr(CSR.mtval),
  mie: cpu.readCsr(CSR.mie),
  mip: cpu.readCsr(CSR.mip),
  mscratch: cpu.readCsr(CSR.mscratch),
  mcounteren: cpu.readCsr(CSR.mcounteren),
  mcycle: cpu.readCsr(CSR.mcycle),
  mcycleh: cpu.readCsr(CSR.mcycleh),
  minstret: cpu.readCsr(CSR.minstret),
  minstreth: cpu.readCsr(CSR.minstreth),
});

export const loadCpuState = (cpu: Cpu, state: CpuState): void => {
  cpu.x.set(state.x);
  cpu.pc = state.pc;
  cpu.privilege = state.privilege;
  cpu.idle = state.idle;
  cpu.writeCsr(CSR.mstatus, state.mstatus);
  cpu.writeCsr(CSR.mtvec, state.mtvec);
  cpu.writeCsr(CSR.mepc, state.mepc);
  cpu.writeCsr(CSR.mcause, state.mcause);
  cpu.writeCsr(CSR.mtval, state.mtval);
  cpu.writeCsr(CSR.mie, state.mie);
  cpu.writeCsr(CSR.mscratch, state.mscratch);
  cpu.writeCsr(CSR.mcounteren, state.mcounteren);
  cpu.writeCsr(CSR.mcycle, state.mcycle);
  cpu.writeCsr(CSR.mcycleh, state.mcycleh);
  cpu.writeCsr(CSR.minstret, state.minstret);
  cpu.writeCsr(CSR.minstreth, state.minstreth);
  // writeCsr는 mip를 무시한다. 장치가 쓰는 비트라 setInterruptPending으로만 바꾼다.
  for (const bit of INTERRUPT_BITS) cpu.setInterruptPending(bit, (state.mip & bit) !== 0);
};
