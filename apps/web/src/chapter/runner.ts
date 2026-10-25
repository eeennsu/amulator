import type { EmulatorController } from '../emulator/mountEmulator';
import type { MachineView } from '../messages';
import type { StepStart, TryAction } from './types';

// 5단계의 타이머가 1초 뒤에 오므로 그보다 넉넉하다.
export const RUN_TIMEOUT_MS = 10_000;
const HEX_RADIX = 16;
const HEX_WIDTH = 8;
const BUSY_MESSAGE = '이전 동작이 아직 끝나지 않았다';

export type WorkerPort = Pick<EmulatorController, 'send' | 'waitFor'>;

type Runner = {
  prepare: (start: StepStart) => Promise<MachineView>;
  perform: (action: TryAction) => Promise<MachineView>;
};

// 한 호출이 쓰는 기다림이다. wait는 호출이 끝나면 abort돼 남은 기다림이 다음 메시지를 가져가지 못한다.
type Call = { wait: WorkerPort['waitFor']; failure: Promise<never> };

export const createStepRunner = (
  port: WorkerPort,
  { timeoutMs = RUN_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Runner => {
  let busy = false;

  // 한 번에 하나만 받는다. 끝나면(성공이든 실패든) 다음 호출을 받는다.
  const exclusive = async <T>(task: (call: Call) => Promise<T>): Promise<T> => {
    if (busy) throw new Error(BUSY_MESSAGE);
    busy = true;
    const controller = new AbortController();
    try {
      const wait: Call['wait'] = (type, predicate) => {
        const waiting = port.waitFor(type, predicate, controller.signal);
        // 경주에서 지거나 abort·닫힘으로 거부돼도 처리 안 된 거부가 되지 않게 한다.
        waiting.catch(() => undefined);
        return waiting;
      };
      const failure = wait('error', (message) => message.id === undefined).then((error) => {
        throw new Error(error.message);
      });
      failure.catch(() => undefined);
      return await task({ wait, failure });
    } finally {
      controller.abort();
      busy = false;
    }
  };

  const nextState = async ({ wait, failure }: Call, trigger: () => void): Promise<MachineView> => {
    const reply = wait('state');
    trigger();
    return (await Promise.race([reply, failure])).state;
  };

  const runTo = async ({ wait, failure }: Call, address: number): Promise<MachineView> => {
    const reached = wait('state', ({ state }) => state.paused && state.cpu.pc === address);
    port.send({ type: 'breakAt', address });
    port.send({ type: 'resume' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        port.send({ type: 'breakAt', address: null });
        port.send({ type: 'pause' });
        const hex = address.toString(HEX_RADIX).padStart(HEX_WIDTH, '0');
        reject(new Error(`0x${hex}까지 가지 못했다`));
      }, timeoutMs);
    });
    try {
      return (await Promise.race([reached, timeout, failure])).state;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    prepare: (start) =>
      exclusive(async (call) => {
        const booted = call.wait('booted');
        port.send({ type: 'pause' });
        port.send({ type: 'reset' });
        await Promise.race([booted, call.failure]);
        if (start.kind === 'runTo') return runTo(call, start.address);
        if (start.kind === 'running') return nextState(call, () => port.send({ type: 'resume' }));
        return nextState(call, () => port.send({ type: 'inspect' }));
      }),
    perform: (action) =>
      exclusive((call) => {
        if (action.kind === 'runTo') return runTo(call, action.address);
        return nextState(call, () =>
          port.send(
            action.kind === 'step'
              ? { type: 'step', count: action.count }
              : { type: 'setRegister', target: action.target, value: action.value },
          ),
        );
      }),
  };
};
