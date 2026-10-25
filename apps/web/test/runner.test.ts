import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createStepRunner, type WorkerPort } from '../src/chapter/runner';
import type { WorkerToMain } from '../src/messages';
import { createFakeCanvas, startWorker, type WorkerHarness } from './helpers/workerHarness';

const ENTRY = 0x8000_0000;
const SHORT_TIMEOUT_MS = 300;

let worker: WorkerHarness | undefined;
let runner: ReturnType<typeof createStepRunner>;

const isType = <T extends WorkerToMain['type']>(
  message: WorkerToMain,
  type: T,
): message is Extract<WorkerToMain, { type: T }> => message.type === type;

const startPausedClock = async (): Promise<WorkerHarness> => {
  const current = await startWorker();
  worker = current;
  current.send({ type: 'pause' }); // 부팅 전 pause는 멈춘 채 시작하게 한다
  current.send({
    type: 'start',
    program: 'clock',
    canvas: createFakeCanvas(),
    persist: false,
  });
  await current.waitFor('booted');
  return current;
};

beforeEach(async () => {
  runner = createStepRunner(await startPausedClock());
});

afterEach(() => {
  worker?.dispose();
  worker = undefined;
});

describe('createStepRunner', () => {
  it('entry는 멈춘 채 진입 주소에 둔다', async () => {
    const view = await runner.prepare({ kind: 'entry' });
    expect(view).toMatchObject({ paused: true, cpu: { pc: ENTRY } });
  });

  it('runTo는 다시 시작해 그 주소에서 멈춘다', async () => {
    await runner.perform({ kind: 'step', count: 5, label: '' }); // 상태를 흐트러뜨린다
    const view = await runner.prepare({ kind: 'runTo', address: 0x8000_0010, expect: '' });
    expect(view).toMatchObject({ paused: true, cpu: { pc: 0x8000_0010 } });
  });

  it('running은 실행 중으로 둔다', async () => {
    expect((await runner.prepare({ kind: 'running' })).paused).toBe(false);
  });

  it('perform의 step과 setRegister는 다음 상태를 돌려준다', async () => {
    await runner.prepare({ kind: 'entry' });
    const stepped = await runner.perform({ kind: 'step', count: 1, label: '' });
    expect(stepped.cpu.pc).not.toBe(ENTRY);
    const written = await runner.perform({
      kind: 'setRegister',
      target: 5,
      value: 0x1234,
      label: '',
    });
    expect(written.cpu.x[5]).toBe(0x1234);
  });

  it('perform의 runTo는 그 주소에서 멈춘다', async () => {
    await runner.prepare({ kind: 'entry' });
    const view = await runner.perform({
      kind: 'runTo',
      address: 0x8000_0010,
      expect: '',
      label: '',
    });
    expect(view).toMatchObject({ paused: true, cpu: { pc: 0x8000_0010 } });
  });

  it('준비 중에 들어온 호출은 거부한다', async () => {
    const first = runner.prepare({ kind: 'entry' });
    await expect(runner.perform({ kind: 'step', count: 1, label: '' })).rejects.toThrow(
      '이전 동작이 아직 끝나지 않았다',
    );
    await first;
  });

  it('주소에 오지 않으면 시간 초과로 알리고 다음 준비는 된다', async () => {
    if (worker === undefined) throw new Error('worker가 없다');
    const slow = createStepRunner(worker, { timeoutMs: SHORT_TIMEOUT_MS });
    // 정렬이 어긋난 주소에는 pc가 오지 않는다
    await expect(slow.prepare({ kind: 'runTo', address: 0x8000_0002, expect: '' })).rejects.toThrow(
      '0x80000002까지 가지 못했다',
    );
    expect((await slow.prepare({ kind: 'entry' })).cpu.pc).toBe(ENTRY);
  });
});

describe('createStepRunner 오류', () => {
  // 'error'만 답하고 나머지는 영영 오지 않는 포트
  const failingPort = (message: string): WorkerPort => ({
    send: () => undefined,
    waitFor: (type, predicate = () => true) =>
      new Promise((resolve) => {
        const reply: WorkerToMain = { type: 'error', message };
        if (isType(reply, type) && predicate(reply)) resolve(reply);
      }),
  });

  it('id 없는 worker 오류는 그 글로 거부하고 다음 호출은 받는다', async () => {
    const failing = createStepRunner(failingPort('명령을 풀지 못했다'));
    await expect(failing.perform({ kind: 'step', count: 1, label: '' })).rejects.toThrow(
      '명령을 풀지 못했다',
    );
    await expect(failing.prepare({ kind: 'entry' })).rejects.toThrow('명령을 풀지 못했다');
  });
});
