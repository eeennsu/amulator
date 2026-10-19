import { dragEvents, tapEvents } from '@amulator/core/control/gestures';
import { BRIDGE_ERROR_CODE, type BridgeRequest } from '@amulator/core/control/protocol';
import type { TouchSample } from '@amulator/core/devices/touch';
import type { Machine } from '@amulator/core/machine';
import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';

import type { MainToWorker, WorkerToMain } from '../messages';
import { PROGRAMS, type ProgramName } from '../programs';
import { createHttpSnapshotStore } from './httpSnapshotStore';
import { createSession, type Session } from './session';
import { createIndexedDbSnapshotStore } from './snapshotStore';
import { createTouchFeeder, type TouchSink } from './touchFeeder';

// 한 구간이 메인 스레드 메시지(터치, 저장)를 막는 시간의 상한이다.
const SLICE_MS = 12;
const CLOCK_CHECK_INSTRUCTIONS = 10_000;
const IDLE_MIN_MS = 1;
const IDLE_MAX_MS = 16;
const MS_PER_SECOND = 1_000;
const STATUS_INTERVAL_MS = MS_PER_SECOND;
const MICROS_PER_MS = 1_000;
const TOUCH_TIMEOUT_MS = 2_000;

type Runtime = { session: Session; context: OffscreenCanvasRenderingContext2D; image: ImageData };

// 브리지의 tap·drag 응답은 게스트가 그 샘플을 모두 꺼낸 뒤에 보낸다.
type TouchWaiter = {
  ticket: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const post = (message: WorkerToMain, transfer: Transferable[] = []): void =>
  self.postMessage(message, transfer);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

let runtime: Runtime | undefined;
let pendingOutput: number[] = [];
let executed = 0;
let statusSince = performance.now();
let sliceQueued = false;
let paused = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let tasks: Promise<void> = Promise.resolve();
const touchFeeder = createTouchFeeder();
let touchWaiters: TouchWaiter[] = [];

// save·reset·start는 서로 끼어들지 않게 한 줄로 세운다(reset 직후에 이전 save의 put이 끝나면 스냅샷이 되살아난다).
const enqueue = (task: () => Promise<void>): void => {
  tasks = tasks.then(task).catch((error: unknown) => {
    post({ type: 'error', message: messageOf(error) });
  });
};

const flushOutput = (): void => {
  if (pendingOutput.length === 0) return;
  post({ type: 'uartOutput', bytes: Uint8Array.from(pendingOutput) });
  pendingOutput = [];
};

const draw = ({ session, context, image }: Runtime): void => {
  const { framebuffer } = session.machine;
  if (!framebuffer.dirty) return;
  framebuffer.toRgba(image.data);
  context.putImageData(image, 0, 0);
  framebuffer.dirty = false;
};

const reportStatus = (now: number): void => {
  const elapsed = now - statusSince;
  if (elapsed < STATUS_INTERVAL_MS) return;
  post({ type: 'status', ips: Math.round((executed * MS_PER_SECOND) / elapsed) });
  executed = 0;
  statusSince = now;
};

// 타이머까지 남은 시간만큼 쉬되 1~16 ms로 가둔다. 0 ms로 돌면 바쁜 루프가 된다.
const idleDelayMs = (machine: Machine): number => {
  const micros = machine.nextTimerDeadlineMicros();
  if (micros === null) return IDLE_MAX_MS;
  return Math.min(Math.max(micros / MICROS_PER_MS, IDLE_MIN_MS), IDLE_MAX_MS);
};

// setTimeout은 중첩되면 4 ms로 올려 잡으므로 다음 구간은 MessageChannel로 예약한다.
const channel = new MessageChannel();

const queueSlice = (): void => {
  if (sliceQueued) return;
  sliceQueued = true;
  channel.port2.postMessage(null);
};

const wake = (): void => {
  if (idleTimer === undefined) return;
  clearTimeout(idleTimer);
  idleTimer = undefined;
  queueSlice();
};

// 예외로 멈춘 루프는 idleTimer도 sliceQueued도 없는 상태라 wake가 깨우지 못한다. start·reset은 무조건 다시 건다.
const restartLoop = (): void => {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  queueSlice();
};

const OK = { ok: true } as const;

// 게스트가 샘플을 모두 꺼낸 tap·drag에 응답한다.
const settleTouch = (touch: TouchSink): void => {
  touchWaiters = touchWaiters.filter((waiter) => {
    if (!touchFeeder.isConsumed(waiter.ticket, touch)) return true;
    clearTimeout(waiter.timer);
    waiter.resolve();
    return false;
  });
};

// 줄 선 터치를 버리고 기다리던 tap·drag를 실패시킨다. 머신이 바뀌면 그 샘플은 뜻이 없다.
const cancelTouch = (): void => {
  touchFeeder.clear();
  for (const waiter of touchWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('머신이 다시 시작되거나 복원되어 터치 입력을 취소했다'));
  }
  touchWaiters = [];
};

// 시간 안에 끝나지 않아도 샘플은 줄에 남는다(멈춘 동안 보낸 tap은 resume하면 전달된다).
const sendGesture = (samples: TouchSample[]): Promise<unknown> => {
  const ticket = touchFeeder.enqueue(samples);
  wake();
  return new Promise((resolve, reject) => {
    const waiter: TouchWaiter = {
      ticket,
      resolve: () => resolve(OK),
      reject,
      timer: setTimeout(() => {
        touchWaiters = touchWaiters.filter((other) => other !== waiter);
        reject(
          new Error(
            `게스트가 터치 입력을 ${TOUCH_TIMEOUT_MS / MS_PER_SECOND}초 안에 처리하지 않았다`,
          ),
        );
      }, TOUCH_TIMEOUT_MS),
    };
    touchWaiters.push(waiter);
  });
};

const runSlice = (): void => {
  if (runtime === undefined || paused) return;
  try {
    const { machine } = runtime.session;
    const deadline = performance.now() + SLICE_MS;
    let idle = false;
    // 게스트가 쉬어도 줄 선 터치를 넣을 자리가 있으면 바로 이어서 먹인다(자리가 없으면 쉰다).
    const hasWork = (): boolean => !idle || touchFeeder.canFeed(machine.touch);
    while (hasWork() && performance.now() < deadline) {
      touchFeeder.feed(machine.touch);
      const result = machine.run(CLOCK_CHECK_INSTRUCTIONS);
      executed += result.executed;
      idle = result.idle;
    }
    settleTouch(machine.touch);
    draw(runtime);
    flushOutput();
    reportStatus(performance.now());
    if (hasWork()) {
      queueSlice();
      return;
    }
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      queueSlice();
    }, idleDelayMs(machine));
  } catch (error: unknown) {
    // 실행 중 예외는 머신 상태를 믿을 수 없다는 뜻이라 루프를 멈춘다.
    flushOutput();
    post({ type: 'error', message: `실행을 멈췄다: ${messageOf(error)}` });
  }
};

channel.port1.onmessage = () => {
  sliceQueued = false;
  runSlice();
};

const start = async (
  program: ProgramName,
  canvas: OffscreenCanvas,
  token: string | undefined,
): Promise<void> => {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas 2d 컨텍스트를 만들 수 없다');
  const response = await fetch(PROGRAMS[program]);
  if (!response.ok) throw new Error(`${program} 프로그램을 받지 못했다: HTTP ${response.status}`);
  const session = createSession({
    // token이 있으면 MCP 모드라서 로컬 서버의 디스크에 저장한다.
    store: token === undefined ? createIndexedDbSnapshotStore() : createHttpSnapshotStore(token),
    clock: { nowMicros: () => performance.now() * MICROS_PER_MS },
    onUartTransmit: (byte) => {
      pendingOutput.push(byte);
    },
  });
  const { restored, warning } = await session.boot(new Uint8Array(await response.arrayBuffer()));
  session.machine.framebuffer.dirty = true; // 게스트가 화면을 쓰지 않아도 첫 화면을 그린다
  runtime = { session, context, image: new ImageData(FB_WIDTH, FB_HEIGHT) };
  cancelTouch();
  post({ type: 'booted', restored, warning });
  restartLoop();
};

const save = async (): Promise<void> => {
  if (runtime === undefined) return;
  const { bytes } = await runtime.session.save();
  post({ type: 'saved', bytes });
};

const reset = async (): Promise<void> => {
  if (runtime === undefined) return;
  await runtime.session.reset();
  cancelTouch();
  runtime.session.machine.framebuffer.dirty = true;
  post({ type: 'booted', restored: false });
  restartLoop();
};

// shortcut: 게스트 시계는 벽시계라 멈춘 동안에도 흐른다, 멈춘 시간이 게스트에 보이면 안 될 때 clock을 멈춘다
const pause = (): void => {
  paused = true;
  clearTimeout(idleTimer);
  idleTimer = undefined;
};

const resume = (): void => {
  paused = false;
  executed = 0; // 멈춘 시간이 IPS에 섞이지 않게 한다
  statusSince = performance.now();
  restartLoop();
};

// 이미 그려져 있어도(dirty가 아니어도) 지금 프레임버퍼를 다시 그린 뒤 찍는다. 멈춘 동안에도 된다.
const capture = async ({ session, context, image }: Runtime): Promise<ArrayBuffer> => {
  session.machine.framebuffer.toRgba(image.data);
  context.putImageData(image, 0, 0);
  const blob = await context.canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
};

const perform = async (
  current: Runtime,
  request: Exclude<BridgeRequest, { method: 'screenshot' }>,
): Promise<unknown> => {
  switch (request.method) {
    case 'tap':
      return sendGesture(tapEvents(request.params));
    case 'drag':
      return sendGesture(dragEvents(request.params.from, request.params.to, request.params.steps));
    case 'snapshot.save':
      return current.session.save();
    case 'snapshot.load': {
      const restored = await current.session.restore();
      cancelTouch();
      current.session.machine.framebuffer.dirty = true;
      return { restored };
    }
    case 'pause':
      pause();
      return OK;
    case 'resume':
      resume();
      return OK;
  }
};

// 예외는 버리지 않고 -32000 응답으로 돌려준다. 요청마다 응답이 하나여야 호출자가 기다리지 않는다.
const serve = async (request: BridgeRequest): Promise<void> => {
  try {
    if (runtime === undefined) throw new Error('아직 부팅하지 않았다');
    if (request.method === 'screenshot') {
      const png = await capture(runtime);
      post({ type: 'bridgeScreenshot', id: request.id, png }, [png]);
      return;
    }
    const result = await perform(runtime, request);
    post({ type: 'bridgeResponse', response: { jsonrpc: '2.0', id: request.id, result } });
  } catch (error: unknown) {
    const failure = { code: BRIDGE_ERROR_CODE.internal, message: messageOf(error) };
    post({ type: 'bridgeResponse', response: { jsonrpc: '2.0', id: request.id, error: failure } });
  }
};

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'start':
      enqueue(() => start(message.program, message.canvas, message.token));
      break;
    case 'uartInput':
      runtime?.session.machine.uart.receive(message.bytes);
      wake();
      break;
    case 'touch':
      // 브리지의 tap·drag와 같은 줄을 지나야 순서가 섞이지 않는다.
      if (runtime !== undefined) touchFeeder.enqueue([message.event]);
      wake();
      break;
    case 'save':
      enqueue(save);
      break;
    case 'reset':
      enqueue(reset);
      break;
    case 'bridge': {
      const { request } = message;
      // tap·drag는 터치처럼 바로 줄에 넣고, 나머지는 start·save·reset과 겹치지 않게 줄 세운다.
      if (request.method === 'tap' || request.method === 'drag') void serve(request);
      else enqueue(() => serve(request));
      break;
    }
  }
};
