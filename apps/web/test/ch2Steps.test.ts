import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { disassemble } from '@amulator/core/cpu/disassemble';
import { parseElf32 } from '@amulator/core/elf';

import { createStepRunner } from '../src/chapter/runner';
import type { CodeAddress, StepPlan, StepStart } from '../src/chapter/types';
import { CH2_STEPS } from '../src/chapters/ch2-cpu/steps';
import type { MachineView } from '../src/messages';
import { createFakeCanvas, startWorker, type WorkerHarness } from './helpers/workerHarness';

const CLOCK = parseElf32(
  new Uint8Array(
    readFileSync(resolve(import.meta.dirname, '../../../guest/baremetal/out/clock.elf')),
  ),
);
const ENTRY = 0x8000_0000;
const WORD_BYTES = 4;
const BYTE_BITS = 8;
const MCAUSE_MACHINE_TIMER = 0x8000_0007;
const A0 = 10;
const LOOP_STEPS = 4; // bgeu, sw, addi, j
const SLOW_TEST_MS = 30_000;

let worker: WorkerHarness | undefined;
let runner: ReturnType<typeof createStepRunner>;

// ELF 세그먼트에서 주소의 4바이트를 리틀엔디언 명령어로 읽는다. 비트 연산은 쓰지 않는다.
const wordAt = (address: number): number => {
  const segment = CLOCK.segments.find(
    ({ paddr, data }) => address >= paddr && address + WORD_BYTES <= paddr + data.length,
  );
  if (segment === undefined) throw new Error(`0x${address.toString(16)}가 ELF 안에 없다`);
  const offset = address - segment.paddr;
  return segment.data
    .subarray(offset, offset + WORD_BYTES)
    .reduce((word, byte, index) => word + byte * 2 ** (BYTE_BITS * index), 0);
};

// 각 단계의 start와 actions에서 주소가 있는 것(runTo)을 모은다.
const codeAddresses = (steps: readonly StepPlan[]): CodeAddress[] =>
  steps
    .flatMap(({ start, actions }) => [start, ...actions])
    .flatMap((item) =>
      item.kind === 'runTo' ? [{ address: item.address, expect: item.expect }] : [],
    );

const startPausedClock = async (): Promise<WorkerHarness> => {
  const current = await startWorker();
  worker = current;
  current.send({ type: 'pause' }); // 부팅 전 pause는 멈춘 채 시작하게 한다
  current.send({ type: 'start', program: 'clock', canvas: createFakeCanvas(), persist: false });
  await current.waitFor('booted');
  return current;
};

const expectStart = (view: MachineView, start: StepStart): void => {
  if (start.kind === 'running') {
    expect(view.paused).toBe(false);
    return;
  }
  expect(view.paused).toBe(true);
  expect(view.cpu.pc).toBe(start.kind === 'entry' ? ENTRY : start.address);
};

const uartText = (harness: WorkerHarness): string =>
  harness.messages
    .flatMap((message) => (message.type === 'uartOutput' ? [...message.bytes] : []))
    .map((byte) => String.fromCharCode(byte))
    .join('');

const stepAt = (index: number): StepPlan => {
  const step = CH2_STEPS[index];
  if (step === undefined) throw new Error(`${index + 1}단계가 없다`);
  return step;
};

beforeEach(async () => {
  runner = createStepRunner(await startPausedClock());
}, SLOW_TEST_MS);

afterEach(() => {
  worker?.dispose();
  worker = undefined;
});

describe('CH2_STEPS', () => {
  it('단계는 5개이고 모두 clock이다', () => {
    expect(CH2_STEPS).toHaveLength(5);
    expect(CH2_STEPS.every(({ program }) => program === 'clock')).toBe(true);
  });

  // 한글 조사가 붙으면 $변수 이름으로 읽히므로 뒤에 기호를 둔다.
  it.each(codeAddresses(CH2_STEPS))('주소 $address: $expect', ({ address, expect: text }) => {
    expect(disassemble(wordAt(address), address)).toBe(text);
  });

  it.each(CH2_STEPS.map((step, index) => [index + 1, step] as const))(
    '%i단계는 시작 상태를 만들고 해 보기가 모두 된다',
    async (_, step) => {
      const start = await runner.prepare(step.start);
      expectStart(start, step.start);
      let view = start;
      for (const action of step.actions) {
        if (action.kind === 'runTo') {
          // runTo 해 보기는 지금 pc와 다른 주소로 간다
          expect(view.paused ? view.cpu.pc : undefined).not.toBe(action.address);
        }
        view = await runner.perform(action);
        if (action.kind === 'runTo') expect(view.cpu.pc).toBe(action.address);
      }
    },
    SLOW_TEST_MS,
  );

  it('3단계 반복은 a0을 4씩 키우고 pc를 되돌린다', async () => {
    const step = stepAt(2);
    const before = await runner.prepare(step.start);
    const views: MachineView[] = [];
    for (const action of step.actions) views.push(await runner.perform(action));
    // 한 바퀴(앞 4개 한 단계)와 한 바퀴 더(마지막)가 끝나면 pc는 bgeu로 돌아오고 a0은 4씩 커진다
    const firstLap = views[LOOP_STEPS - 1];
    const secondLap = views[LOOP_STEPS];
    expect(views).toHaveLength(LOOP_STEPS + 1);
    expect(firstLap?.cpu.pc).toBe(before.cpu.pc);
    expect(firstLap?.cpu.x[A0]).toBe((before.cpu.x[A0] ?? 0) + WORD_BYTES);
    expect(secondLap?.cpu.pc).toBe(before.cpu.pc);
    expect(secondLap?.cpu.x[A0]).toBe((before.cpu.x[A0] ?? 0) + 2 * WORD_BYTES);
  });

  it('4단계는 고친 값이 터미널의 uptime 숫자로 나온다', async () => {
    if (worker === undefined) throw new Error('worker가 없다');
    const step = stepAt(3);
    await runner.prepare(step.start);
    for (const action of step.actions) await runner.perform(action);
    const written = step.actions.find(({ kind }) => kind === 'setRegister');
    if (written?.kind !== 'setRegister') throw new Error('값을 고치는 해 보기가 없다');
    expect(uartText(worker)).toContain(`uptime: ${written.value} s`);
  });

  it('5단계는 mcause가 타이머 인터럽트이고 mepc가 돌아올 주소다', async () => {
    const step = stepAt(4);
    await runner.prepare(step.start);
    const views: MachineView[] = [];
    for (const action of step.actions) views.push(await runner.perform(action));
    const [atTrap, atMret, returned] = views;
    expect(atTrap?.cpu.csr.mcause).toBe(MCAUSE_MACHINE_TIMER);
    expect(atTrap?.cpu.pc).toBe(CLOCK.symbols.get('trap_entry'));
    expect(returned?.cpu.pc).toBe(atTrap?.cpu.csr.mepc);
    expect(atMret?.cpu.csr.mepc).toBe(atTrap?.cpu.csr.mepc);
    expect(returned?.cpu.pc).not.toBe(atMret?.cpu.pc);
  });

  it('2단계는 sp를 정하고 mtvec에 trap_entry를 쓴다', async () => {
    const step = stepAt(1);
    const start = await runner.prepare(step.start);
    expect(start.cpu.pc).toBe(ENTRY);
    const views: MachineView[] = [];
    for (const action of step.actions) views.push(await runner.perform(action));
    expect(views.at(-1)?.cpu.csr.mtvec).toBe(CLOCK.symbols.get('trap_entry'));
    expect(views[0]?.cpu.x[2]).not.toBe(start.cpu.x[2]); // sp
  });
});
