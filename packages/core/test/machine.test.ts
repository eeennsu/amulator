import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PRIVILEGE } from '../src/cpu/cpu';
import { createMachine } from '../src/machine';
import { CLINT_BASE, RAM_SIZE } from '../src/memoryMap';

const GUEST_OUT = resolve(import.meta.dirname, '../../../guest/baremetal/out');
const MTIMECMP_LO = CLINT_BASE + 0x4000;
const MTIMECMP_HI = CLINT_BASE + 0x4004;
const SECOND = 1_000_000;
const BOOT_BUDGET = 100_000;

// 시계는 테스트가 움직이고, UART 출력은 문자열로 모은다.
const setup = (elfName: string) => {
  const state = { now: 0, output: '' };
  const machine = createMachine({
    clock: { nowMicros: () => state.now },
    onUartTransmit: (byte) => {
      state.output += String.fromCharCode(byte);
    },
  });
  const elf = machine.loadElf(new Uint8Array(readFileSync(resolve(GUEST_OUT, elfName))));
  return { state, machine, elf };
};

const bootClock = () => {
  const guest = setup('clock.elf');
  const result = guest.machine.run(BOOT_BUDGET);
  return { ...guest, result };
};

describe('loadElf', () => {
  it('pc를 entry로, a0·a1을 0으로, M 모드로 시작한다', () => {
    const { machine, elf } = setup('hello.elf');
    machine.cpu.x[10] = 7;
    machine.cpu.x[11] = 7;
    machine.cpu.privilege = PRIVILEGE.user;
    machine.loadElf(new Uint8Array(readFileSync(resolve(GUEST_OUT, 'hello.elf'))));
    expect(machine.cpu.pc).toBe(elf.entry);
    expect([machine.cpu.x[10], machine.cpu.x[11]]).toEqual([0, 0]);
    expect(machine.cpu.privilege).toBe(PRIVILEGE.machine);
    expect(machine.ram.length).toBe(RAM_SIZE);
  });
});

describe('hello.elf', () => {
  it('인사를 UART로 내고 wfi에서 멈춘다', () => {
    const { state, machine } = setup('hello.elf');
    const result = machine.run(BOOT_BUDGET);
    expect(state.output).toBe('hello from amulator\n');
    expect(result.idle).toBe(true);
    expect(result.executed).toBeLessThan(BOOT_BUDGET);
  });
});

describe('clock.elf', () => {
  it('시작 문구를 내고 타이머를 기다리며 멈춘다', () => {
    const { state, machine, result } = bootClock();
    expect(state.output).toBe('clock ready\n');
    expect(result.idle).toBe(true);
    expect(machine.nextTimerDeadlineMicros()).toBe(SECOND);
  });

  it('시계가 3초 가면 uptime을 1, 2, 3 순서로 낸다', () => {
    const { state, machine } = bootClock();
    state.now = 3 * SECOND;
    const result = machine.run(500_000);
    expect(state.output).toBe('clock ready\nuptime: 1 s\nuptime: 2 s\nuptime: 3 s\n');
    expect(result.idle).toBe(true);
    expect(machine.nextTimerDeadlineMicros()).toBe(SECOND);
  });

  it('받은 바이트를 그대로 되돌려 보낸다', () => {
    const { state, machine } = bootClock();
    machine.uart.receive(new TextEncoder().encode('hi'));
    const result = machine.run(BOOT_BUDGET);
    expect(state.output).toBe('clock ready\nhi');
    expect(result.idle).toBe(true);
  });

  it('게스트가 wfi에 닿기 전에 온 입력도 놓치지 않는다', () => {
    const { state, machine } = setup('clock.elf');
    machine.uart.receive(new TextEncoder().encode('ok'));
    const result = machine.run(BOOT_BUDGET);
    expect(state.output).toBe('clock ready\nok');
    expect(result.idle).toBe(true);
  });
});

describe('nextTimerDeadlineMicros', () => {
  it('mtimecmp가 꺼져 있으면 null이다', () => {
    const { machine } = setup('hello.elf');
    expect(machine.nextTimerDeadlineMicros()).toBeNull();
  });

  it('mtimecmp까지 남은 마이크로초를 돌려주고, 지났으면 0이다', () => {
    const { state, machine } = setup('hello.elf');
    machine.bus.write(MTIMECMP_HI, 4, 0);
    machine.bus.write(MTIMECMP_LO, 4, SECOND);
    expect(machine.nextTimerDeadlineMicros()).toBe(SECOND);
    state.now = 400_000;
    expect(machine.nextTimerDeadlineMicros()).toBe(600_000);
    state.now = 2 * SECOND;
    expect(machine.nextTimerDeadlineMicros()).toBe(0);
  });
});
