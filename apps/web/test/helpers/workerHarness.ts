import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { vi } from 'vitest';

import type { MainToWorker, WorkerToMain } from '../../src/messages';

const GUEST_OUT = resolve(import.meta.dirname, '../../../../guest/baremetal/out');
// 64 MiB 머신 생성과 부팅이 느린 환경에서도 기다릴 수 있게 넉넉히 둔다.
const WAIT_TIMEOUT_MS = 20_000;
const ABORTED_MESSAGE = '기다림을 취소했다';
// Node에는 IndexedDB가 없어 저장소를 못 읽고 새로 부팅하는 것이 정상이다. 이 경고만 삼킨다.
const EXPECTED_WARNINGS = ['스냅샷 저장소를 읽지 못해', '스냅샷을 지우지 못했다'];

type Handler = (event: MessageEvent<MainToWorker>) => void;
type Predicate<T> = (message: T) => boolean;

export type WorkerHarness = {
  send: (message: MainToWorker) => void;
  messages: WorkerToMain[];
  waitFor: <T extends WorkerToMain['type']>(
    type: T,
    predicate?: Predicate<Extract<WorkerToMain, { type: T }>>,
    signal?: AbortSignal,
  ) => Promise<Extract<WorkerToMain, { type: T }>>;
  dispose: () => void;
};

type Waiter = { poll: () => boolean; timer: NodeJS.Timeout };

// Node에는 OffscreenCanvas가 없고, 워커가 쓰는 getContext만 흉내 낸 객체를 그 타입으로 좁힌다.
const isOffscreenCanvas = (value: object): value is OffscreenCanvas => 'getContext' in value;

// getContext('2d')가 putImageData와 convertToBlob만 가진 캔버스다.
export const createFakeCanvas = (): OffscreenCanvas => {
  const context = {
    putImageData: () => undefined,
    canvas: { convertToBlob: () => Promise.resolve(new Blob()) },
  };
  const canvas = { getContext: () => context };
  if (!isOffscreenCanvas(canvas)) throw new Error('가짜 캔버스를 만들지 못했다');
  return canvas;
};

// 모듈 상태(runtime, paused 등)가 테스트마다 새로 생기도록 매번 모듈을 다시 읽는다.
export const startWorker = async (): Promise<WorkerHarness> => {
  const messages: WorkerToMain[] = [];
  let waiters: Waiter[] = [];
  let cursor = 0; // waitFor가 이미 넘겨 준 메시지 뒤부터 찾는다

  const realWarn = console.warn.bind(console);
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const [first] = args;
    if (typeof first === 'string' && EXPECTED_WARNINGS.some((text) => first.includes(text))) return;
    realWarn(...args);
  });
  const fakeSelf: { postMessage: (message: WorkerToMain) => void; onmessage: Handler | null } = {
    postMessage: (message) => {
      messages.push(message);
      waiters = waiters.filter((waiter) => !waiter.poll());
    },
    onmessage: null,
  };
  vi.stubGlobal('self', fakeSelf);
  vi.stubGlobal('fetch', async (url: string) => {
    const name = basename(new URL(url, 'http://localhost').pathname);
    return new Response(await readFile(resolve(GUEST_OUT, name)));
  });
  vi.stubGlobal(
    'ImageData',
    class {
      readonly data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
  vi.resetModules();
  await import('../../src/worker/emulatorWorker');

  const send = (message: MainToWorker): void => {
    fakeSelf.onmessage?.(new MessageEvent('message', { data: message }));
  };

  const waitFor: WorkerHarness['waitFor'] = (type, predicate = () => true, signal) =>
    new Promise((resolvePromise, reject) => {
      if (signal?.aborted) {
        reject(new Error(ABORTED_MESSAGE));
        return;
      }
      const poll = (): boolean => {
        for (let index = cursor; index < messages.length; index += 1) {
          const message = messages[index];
          if (message?.type !== type) continue;
          // 같은 type 안에서만 좁혀지므로 predicate 인자의 타입이 맞다.
          const narrowed = message as Extract<WorkerToMain, { type: typeof type }>;
          if (!predicate(narrowed)) continue;
          cursor = index + 1;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolvePromise(narrowed);
          return true;
        }
        return false;
      };
      // abort된 기다림은 더 이상 메시지를 가져가지 않는다.
      const onAbort = (): void => {
        clearTimeout(timer);
        waiters = waiters.filter((waiter) => waiter.poll !== poll);
        reject(new Error(ABORTED_MESSAGE));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        waiters = waiters.filter((waiter) => waiter.poll !== poll);
        const seen = messages
          .slice(cursor)
          .map((message) =>
            message.type === 'error' ? `error(${message.message})` : message.type,
          );
        reject(
          new Error(
            `${type} 메시지가 ${WAIT_TIMEOUT_MS} ms 안에 오지 않았다: [${seen.join(', ')}]`,
          ),
        );
      }, WAIT_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (!poll()) waiters.push({ poll, timer });
    });

  return {
    send,
    messages,
    waitFor,
    dispose: () => {
      send({ type: 'pause' }); // 루프가 멈추면 남은 타이머와 구간 예약이 아무것도 하지 않는다
      for (const waiter of waiters) clearTimeout(waiter.timer);
      waiters = [];
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
};
