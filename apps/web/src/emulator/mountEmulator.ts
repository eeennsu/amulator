import type { SnapshotMeta, SnapshotSection } from '@amulator/core/snapshot';

import { connectBridge } from '../bridge';
import type { MainToWorker, WorkerToMain } from '../messages';
import { toFramebufferPoint } from '../pointer';
import type { ProgramName } from '../programs';
import { createTerminal } from '../terminal';
import { createRequestTable } from './requests';

const SCREEN_ID = 'screen';
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 480;
const CLOSED_MESSAGE = '에뮬레이터가 닫혔다';
const ABORTED_MESSAGE = '기다림을 취소했다';

type Slots = { screen: HTMLElement; terminal: HTMLElement };

type Options = {
  program: ProgramName;
  token: string | null;
  persist: boolean;
  startPaused: boolean;
  onMessage: (message: WorkerToMain) => void;
  onBridgeStatus: (text: string) => void;
};

type SnapshotInfo = { meta: SnapshotMeta; sections: SnapshotSection[]; gzipBytes: number };

type Reply = Extract<WorkerToMain, { type: 'memory' | 'snapshotInfo' }>;

type MessageOf<T extends WorkerToMain['type']> = Extract<WorkerToMain, { type: T }>;

type Waiter = { accept: (message: WorkerToMain) => boolean; reject: (error: Error) => void };

const isType = <T extends WorkerToMain['type']>(
  message: WorkerToMain,
  type: T,
): message is MessageOf<T> => message.type === type;

export type EmulatorController = {
  send: (message: MainToWorker) => void;
  // 부른 뒤에 오는 메시지만 본다. 시간 제한은 없고, dispose하면 거부한다.
  // signal이 abort되면 기다림을 목록에서 빼고 `기다림을 취소했다`로 거부한다.
  waitFor: <T extends WorkerToMain['type']>(
    type: T,
    predicate?: (message: MessageOf<T>) => boolean,
    signal?: AbortSignal,
  ) => Promise<MessageOf<T>>;
  peek: (address: number, length: number) => Promise<Uint8Array>;
  describeSnapshot: () => Promise<SnapshotInfo>;
  dispose: () => void;
};

export const mountEmulator = (slots: Slots, options: Options): EmulatorController => {
  const { program, token, persist, startPaused } = options;
  let disposed = false;
  // 닫힌 뒤에 오는 콜백(소켓 close 등)이 다음 마운트의 상태를 덮지 않게 막는다.
  const onMessage = (message: WorkerToMain): void => {
    if (!disposed) options.onMessage(message);
  };
  const onBridgeStatus = (text: string): void => {
    if (!disposed) options.onBridgeStatus(text);
  };

  const worker = new Worker(new URL('../worker/emulatorWorker.ts', import.meta.url), {
    type: 'module',
  });
  const post = (message: MainToWorker, transfer: Transferable[] = []): void =>
    worker.postMessage(message, transfer);
  const send = (message: MainToWorker): void => post(message);

  // peek와 describeSnapshot이 한 표를 쓴다. id가 겹치지 않아야 id가 있는 error를 알맞은 요청에 돌려줄 수 있다.
  const requests = createRequestTable<Reply>();
  const waiters = new Set<Waiter>();

  // StrictMode는 마운트를 두 번 하므로 canvas도 마운트마다 새로 만든다. 한 canvas는 한 번만 넘길 수 있다.
  const canvas = document.createElement('canvas');
  canvas.id = SCREEN_ID;
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
  slots.screen.append(canvas);

  const terminal = createTerminal(slots.terminal, (bytes) => send({ type: 'uartInput', bytes }));

  // MCP 모드(URL에 token이 있을 때)에서만 로컬 서버와 잇는다.
  const bridge =
    token === null
      ? undefined
      : connectBridge(token, (request) => send({ type: 'bridge', request }), onBridgeStatus);

  worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
    const message = event.data;
    switch (message.type) {
      case 'uartOutput':
        terminal.write(message.bytes);
        break;
      case 'booted':
        terminal.clear(); // 새로 부팅한 게스트는 처음부터 다시 출력한다
        break;
      case 'bridgeResponse':
        bridge?.respond(message.response);
        break;
      case 'bridgeScreenshot':
        bridge?.respondScreenshot(message.id, message.png);
        break;
      case 'memory':
      case 'snapshotInfo':
        requests.resolve(message.id, message);
        break;
      case 'error':
        if (message.id !== undefined) requests.reject(message.id, new Error(message.message));
        break;
    }
    for (const waiter of [...waiters]) {
      if (waiter.accept(message)) waiters.delete(waiter);
    }
    onMessage(message);
  };
  worker.onerror = (event) =>
    onMessage({ type: 'error', message: `worker 오류: ${event.message}` });

  // 눌린 상태에서만 움직임을 보낸다. 포인터 캡처가 canvas 밖에서 뗀 것도 잡아 준다.
  const listeners = new AbortController();
  const { signal } = listeners;
  let pressed = false;
  let lastPoint = { x: 0, y: 0 };
  const pointOf = (event: PointerEvent): { x: number; y: number } =>
    toFramebufferPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
  const sendTouch = (point: { x: number; y: number }, down: boolean): void => {
    lastPoint = point;
    send({ type: 'touch', event: { ...point, down } });
  };

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isPrimary) return;
      pressed = true;
      canvas.setPointerCapture(event.pointerId);
      sendTouch(pointOf(event), true);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (pressed && event.isPrimary) sendTouch(pointOf(event), true);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (!pressed || !event.isPrimary) return;
      pressed = false;
      sendTouch(pointOf(event), false);
    },
    { signal },
  );
  // 취소된 포인터의 좌표는 믿을 수 없어서 마지막 점에서 뗀다.
  canvas.addEventListener(
    'pointercancel',
    (event) => {
      if (!pressed || !event.isPrimary) return;
      pressed = false;
      sendTouch(lastPoint, false);
    },
    { signal },
  );

  const offscreen = canvas.transferControlToOffscreen();
  // 부팅 전 pause는 멈춘 채 시작하게 한다.
  if (startPaused) send({ type: 'pause' });
  post({ type: 'start', program, canvas: offscreen, token: token ?? undefined, persist }, [
    offscreen,
  ]);

  return {
    send,
    waitFor: (type, predicate = () => true, signal) => {
      if (disposed) return Promise.reject(new Error(CLOSED_MESSAGE));
      if (signal?.aborted) return Promise.reject(new Error(ABORTED_MESSAGE));
      return new Promise((resolve, reject) => {
        const onAbort = (): void => {
          waiters.delete(waiter);
          reject(new Error(ABORTED_MESSAGE));
        };
        const waiter: Waiter = {
          reject,
          accept: (message) => {
            if (!isType(message, type) || !predicate(message)) return false;
            signal?.removeEventListener('abort', onAbort);
            resolve(message);
            return true;
          },
        };
        waiters.add(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    peek: async (address, length) => {
      if (disposed) throw new Error(CLOSED_MESSAGE);
      const { id, promise } = requests.open();
      send({ type: 'peek', id, address, length });
      const reply = await promise;
      if (reply.type !== 'memory') throw new Error(`peek에 ${reply.type} 응답이 왔다`);
      return reply.bytes;
    },
    describeSnapshot: async () => {
      if (disposed) throw new Error(CLOSED_MESSAGE);
      const { id, promise } = requests.open();
      send({ type: 'describeSnapshot', id });
      const reply = await promise;
      if (reply.type !== 'snapshotInfo') {
        throw new Error(`describeSnapshot에 ${reply.type} 응답이 왔다`);
      }
      return { meta: reply.meta, sections: reply.sections, gzipBytes: reply.gzipBytes };
    },
    dispose: () => {
      disposed = true;
      worker.terminate();
      listeners.abort();
      canvas.remove();
      terminal.dispose();
      bridge?.close();
      requests.rejectAll(new Error(CLOSED_MESSAGE));
      for (const waiter of waiters) waiter.reject(new Error(CLOSED_MESSAGE));
      waiters.clear();
    },
  };
};
