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

export const createStepRunner = (
  port: WorkerPort,
  { timeoutMs = RUN_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Runner => {
  let busy = false;

  // 한 번에 하나만 받는다. 끝나면(성공이든 실패든) 다음 호출을 받는다.
  const exclusive = async <T>(task: (failure: Promise<never>) => Promise<T>): Promise<T> => {
    if (busy) throw new Error(BUSY_MESSAGE);
    busy = true;
    try {
      const failure = port
        .waitFor('error', (message) => message.id === undefined)
        .then((error) => {
          throw new Error(error.message);
        });
      // 경주에서 지거나 닫힘으로 거부돼도 처리 안 된 거부가 되지 않게 한다.
      failure.catch(() => undefined);
      return await task(failure);
    } finally {
      busy = false;
    }
  };

  const nextState = async (failure: Promise<never>, trigger: () => void): Promise<MachineView> => {
    const reply = port.waitFor('state');
    trigger();
    return (await Promise.race([reply, failure])).state;
  };

  const runTo = async (address: number, failure: Promise<never>): Promise<MachineView> => {
    const reached = port.waitFor('state', ({ state }) => state.paused && state.cpu.pc === address);
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
      exclusive(async (failure) => {
        const booted = port.waitFor('booted');
        port.send({ type: 'pause' });
        port.send({ type: 'reset' });
        await Promise.race([booted, failure]);
        if (start.kind === 'runTo') return runTo(start.address, failure);
        if (start.kind === 'running')
          return nextState(failure, () => port.send({ type: 'resume' }));
        return nextState(failure, () => port.send({ type: 'inspect' }));
      }),
    perform: (action) =>
      exclusive((failure) => {
        if (action.kind === 'runTo') return runTo(action.address, failure);
        return nextState(failure, () =>
          port.send(
            action.kind === 'step'
              ? { type: 'step', count: action.count }
              : { type: 'setRegister', target: action.target, value: action.value },
          ),
        );
      }),
  };
};
