import { createBus, type Bus } from './bus';
import { Cpu, PRIVILEGE } from './cpu/cpu';
import { CSR, MIP_MSIP, MIP_MTIP } from './cpu/csr';
import { createClint, type Clint, type Clock } from './devices/clint';
import { createUart16550, type Uart16550 } from './devices/uart16550';
import { loadElfIntoRam, parseElf32, type ElfImage } from './elf';
import { RAM_SIZE } from './memoryMap';

export type { Clock };

export type MachineOptions = {
  clock: Clock;
  onUartTransmit: (byte: number) => void;
  ramSize?: number;
};

export type RunResult = { executed: number; idle: boolean };

export type Machine = {
  readonly cpu: Cpu;
  readonly bus: Bus;
  readonly ram: Uint8Array;
  readonly uart: Uart16550;
  readonly clint: Clint;
  loadElf: (bytes: Uint8Array) => ElfImage; // 세그먼트 적재, pc = entry, a0 = 0, a1 = 0, M 모드
  run: (maxInstructions: number) => RunResult;
  nextTimerDeadlineMicros: () => number | null; // mtimecmp까지 남은 µs, 꺼져 있으면 null
};

// 시계는 명령어와 무관하게 흐르므로 CLINT 상태를 이 간격마다 mip에 옮긴다.
const SYNC_INTERVAL = 256;
// mtimecmp의 상위 워드가 모두 1이면 타이머가 꺼진 것이다(게스트가 쓰는 갱신 순서의 중간 상태).
const MTIMECMP_DISARMED = 0xffff_ffff * 0x1_0000_0000;

export const createMachine = ({
  clock,
  onUartTransmit,
  ramSize = RAM_SIZE,
}: MachineOptions): Machine => {
  const ram = new Uint8Array(ramSize);
  const rawClint = createClint(clock);
  const rawUart = createUart16550(onUartTransmit);

  // 입력이 오면 wfi를 한 번 깨운다. UART 인터럽트가 없어서 이 이벤트가 유일한 깨움 경로다.
  // 래치라서 게스트가 wfi에 닿기 전에 온 입력도 놓치지 않는다.
  let wakeEvent = false;
  const uart: Uart16550 = {
    ...rawUart,
    receive: (bytes) => {
      rawUart.receive(bytes);
      if (bytes.length > 0) wakeEvent = true;
    },
  };
  // CLINT에 쓴 직후 mip를 맞춘다. 게스트가 mtimecmp를 올리는 순간 인터럽트가 내려가야 한다.
  const clint: Clint = {
    ...rawClint,
    write: (offset, width, value) => {
      rawClint.write(offset, width, value);
      syncInterrupts();
    },
  };

  const bus = createBus(ram, [uart, clint]);
  const cpu = new Cpu(bus, clint.mtime);

  const syncInterrupts = (): void => {
    cpu.setInterruptPending(MIP_MTIP, clint.timerPending());
    cpu.setInterruptPending(MIP_MSIP, clint.softwarePending());
  };

  // wfi로 쉬는 중이면 깨울 것이 있는지 보고, 깨울 것이 없을 때만 true다.
  // 깨우는 데는 전역 MIE가 필요 없다. Cpu.run은 쉬는 동안의 no-op도 예산으로 세므로 직접 확인한다.
  const settleIdle = (): boolean => {
    if (!cpu.idle) return false;
    syncInterrupts();
    if (wakeEvent || (cpu.readCsr(CSR.mip) & cpu.readCsr(CSR.mie)) !== 0) {
      wakeEvent = false;
      cpu.idle = false;
      return false;
    }
    return true;
  };

  const run = (maxInstructions: number): RunResult => {
    let executed = 0;
    while (executed < maxInstructions) {
      if (executed % SYNC_INTERVAL === 0) syncInterrupts();
      if (settleIdle()) return { executed, idle: true };
      cpu.step();
      executed += 1;
    }
    return { executed, idle: settleIdle() };
  };

  const loadElf = (bytes: Uint8Array): ElfImage => {
    const image = parseElf32(bytes);
    loadElfIntoRam(ram, image);
    cpu.pc = image.entry;
    cpu.x[10] = 0; // a0: hartid
    cpu.x[11] = 0; // a1: 장치 트리 포인터 없음
    cpu.privilege = PRIVILEGE.machine;
    cpu.idle = false;
    return image;
  };

  const nextTimerDeadlineMicros = (): number | null => {
    const compare = clint.mtimecmp();
    return compare >= MTIMECMP_DISARMED ? null : Math.max(0, compare - clint.mtime());
  };

  return { cpu, bus, ram, uart, clint, loadElf, run, nextTimerDeadlineMicros };
};
