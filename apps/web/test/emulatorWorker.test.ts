import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseElf32 } from '@amulator/core/elf';
import { RAM_BASE, RAM_SIZE, UART_BASE } from '@amulator/core/memoryMap';

import type { MainToWorker } from '../src/messages';
import { createFakeCanvas, startWorker, type WorkerHarness } from './helpers/workerHarness';

const PAINT = new Uint8Array(
  readFileSync(resolve(import.meta.dirname, '../../../guest/baremetal/out/paint.elf')),
);
const ENTRY = 0x8000_0000;
const PEEK_LENGTH = 16;
const TAP = { x: 160, y: 240 };
const QUIET_MS = 200;
// 64 MiB 머신 생성과 스냅샷 압축이 느린 환경에서는 기본 5초를 넘길 수 있다.
const SLOW_TEST_MS = 30_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

let worker: WorkerHarness | undefined;

const start = async (): Promise<WorkerHarness> => {
  worker = await startWorker();
  worker.send({ type: 'start', program: 'paint', canvas: createFakeCanvas() });
  await worker.waitFor('booted');
  return worker;
};

const inspect = async (current: WorkerHarness) => {
  current.send({ type: 'inspect' });
  return (await current.waitFor('state')).state;
};

const pause = async (current: WorkerHarness) => {
  current.send({ type: 'pause' });
  return (await current.waitFor('state')).state;
};

const control = async (current: WorkerHarness, message: MainToWorker) => {
  current.send(message);
  return (await current.waitFor('state')).state;
};

afterEach(() => {
  worker?.dispose();
  worker = undefined;
});

describe('emulatorWorker', { timeout: SLOW_TEST_MS }, () => {
  it('booted에 ELF 요약과 메모리 맵이 있다', async () => {
    const current = await start();
    const booted = current.messages.find((message) => message.type === 'booted');
    if (booted?.type !== 'booted') throw new Error('booted가 없다');
    expect(booted.elf.entry).toBe(ENTRY);
    expect(booted.elf.segments.length).toBeGreaterThanOrEqual(1);
    expect(booted.regions.map(({ name }) => name)).toEqual([
      'ram',
      'uart16550',
      'clint',
      'framebuffer',
      'touch',
    ]);
  });

  it('멈추고 한 단계씩 실행하면 pc가 움직인다', async () => {
    const current = await start();
    expect((await pause(current)).paused).toBe(true);
    const first = await control(current, { type: 'step', count: 1 });
    const second = await control(current, { type: 'step', count: 1 });
    expect(second.cpu.pc).not.toBe(first.cpu.pc);
  });

  it('실행 중의 step은 거부한다', async () => {
    const current = await start();
    current.send({ type: 'step', count: 1 });
    await current.waitFor('error');
    expect(current.messages.some((message) => message.type === 'state')).toBe(false);
  });

  it('x0은 쓰지 않고 다른 레지스터와 pc는 쓴다', async () => {
    const current = await start();
    await pause(current);
    const zero = await control(current, { type: 'setRegister', target: 0, value: 5 });
    expect(zero.cpu.x[0]).toBe(0);
    const reg = await control(current, { type: 'setRegister', target: 5, value: 0xdead_beef });
    expect(reg.cpu.x[5]).toBe(0xdead_beef);
    const pc = await control(current, { type: 'setRegister', target: 'pc', value: 0x8000_0010 });
    expect(pc.cpu.pc).toBe(0x8000_0010);
  });

  it('peek은 RAM 바이트를 돌려주고 잘못된 구간은 id를 단 오류다', async () => {
    const current = await start();
    await pause(current);
    current.send({ type: 'peek', id: 1, address: RAM_BASE, length: PEEK_LENGTH });
    const memory = await current.waitFor('memory');
    const [segment] = parseElf32(PAINT).segments;
    expect(memory.id).toBe(1);
    expect(Array.from(memory.bytes)).toEqual(Array.from(segment?.data.slice(0, PEEK_LENGTH) ?? []));
    current.send({ type: 'peek', id: 2, address: 0, length: PEEK_LENGTH });
    expect((await current.waitFor('error')).id).toBe(2);
  });

  it('UART에 쓰면 출력으로 나온다', async () => {
    const current = await start();
    current.send({ type: 'busWrite', address: UART_BASE, width: 1, value: 0x41 });
    const output = await current.waitFor('uartOutput', ({ bytes }) => bytes.includes(0x41));
    expect(output.bytes).toContain(0x41);
  });

  it('없는 주소에 쓰면 오류를 알리고 계속 응답한다', async () => {
    const current = await start();
    current.send({ type: 'busWrite', address: 0, width: 4, value: 1 });
    await current.waitFor('error');
    expect(await inspect(current)).toBeDefined();
  });

  it('기록을 켜고 탭하면 touch 장치 읽기가 기록된다', async () => {
    const current = await start();
    current.send({ type: 'trace', enabled: true });
    current.send({ type: 'gesture', gesture: { kind: 'tap', at: TAP } });
    const { accesses } = await current.waitFor('deviceAccesses', ({ accesses: list }) =>
      list.some(({ device, kind }) => device === 'touch' && kind === 'read'),
    );
    expect(accesses.length).toBeGreaterThan(0);

    current.send({ type: 'trace', enabled: false });
    const before = current.messages.filter(({ type }) => type === 'deviceAccesses').length;
    current.send({ type: 'gesture', gesture: { kind: 'tap', at: TAP } });
    await sleep(QUIET_MS);
    expect(current.messages.filter(({ type }) => type === 'deviceAccesses')).toHaveLength(before);
    expect(await inspect(current)).toBeDefined(); // 워커는 계속 응답한다
  });

  it('멈춘 채 reset하면 멈춘 채 진입 주소에 있다', async () => {
    const current = await start();
    await pause(current);
    current.send({ type: 'reset' });
    await current.waitFor('booted');
    const state = await inspect(current);
    expect(state.paused).toBe(true);
    expect(state.cpu.pc).toBe(ENTRY);
  });

  it('reset 뒤에도 기록이 이어진다', async () => {
    const current = await start();
    current.send({ type: 'trace', enabled: true });
    current.send({ type: 'reset' });
    await current.waitFor('booted');
    current.send({ type: 'gesture', gesture: { kind: 'tap', at: TAP } });
    await current.waitFor('deviceAccesses');
  });

  it('describeSnapshot은 구간과 압축 크기를 돌려준다', async () => {
    const current = await start();
    await pause(current); // 달리는 루프가 구간마다 이벤트 루프를 잡으면 64 MiB 압축이 수십 초 걸린다
    current.send({ type: 'describeSnapshot', id: 3 });
    const info = await current.waitFor('snapshotInfo');
    expect(info.id).toBe(3);
    expect(info.sections).toContainEqual({ name: 'ram', bytes: RAM_SIZE });
    expect(info.gzipBytes).toBeGreaterThan(0);
    expect(info.gzipBytes).toBeLessThan(RAM_SIZE);
  });
});
