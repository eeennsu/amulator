import { dragEvents, tapEvents } from '@amulator/core/control/gestures';
import { BRIDGE_ERROR_CODE, type BridgeRequest } from '@amulator/core/control/protocol';
import { TOUCH_QUEUE_DEPTH, type TouchSample } from '@amulator/core/devices/touch';
import type { Machine } from '@amulator/core/machine';
import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';

import type { MainToWorker, WorkerToMain } from '../messages';
import { PROGRAMS, type ProgramName } from '../programs';
import { createHttpSnapshotStore } from './httpSnapshotStore';
import { createSession, type Session } from './session';
import { createIndexedDbSnapshotStore } from './snapshotStore';

// 한 구간이 메인 스레드 메시지(터치, 저장)를 막는 시간의 상한이다.
const SLICE_MS = 12;
const CLOCK_CHECK_INSTRUCTIONS = 10_000;
const IDLE_MIN_MS = 1;
const IDLE_MAX_MS = 16;
const MS_PER_SECOND = 1_000;
const STATUS_INTERVAL_MS = MS_PER_SECOND;
const MICROS_PER_MS = 1_000;

type Runtime = { session: Session; context: OffscreenCanvasRenderingContext2D; image: ImageData };

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

const runSlice = (): void => {
  if (runtime === undefined || paused) return;
  try {
    const { machine } = runtime.session;
    const deadline = performance.now() + SLICE_MS;
    let idle = false;
    while (!idle && performance.now() < deadline) {
      const result = machine.run(CLOCK_CHECK_INSTRUCTIONS);
      executed += result.executed;
      idle = result.idle;
    }
    draw(runtime);
    flushOutput();
    reportStatus(performance.now());
    if (!idle) {
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

const OK = { ok: true } as const;

// 큐가 차면 touch.push가 가장 오래된 것부터 버리므로, 누르기가 사라지느니 요청을 거절한다.
const pushTouch = ({ session }: Runtime, samples: TouchSample[]): void => {
  const { touch } = session.machine;
  if (touch.queueLength + samples.length > TOUCH_QUEUE_DEPTH) {
    throw new Error(
      `터치 큐(${TOUCH_QUEUE_DEPTH})가 넘친다. 게스트가 비운 뒤 steps를 줄여 다시 보낸다`,
    );
  }
  for (const sample of samples) touch.push(sample);
  wake();
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
      pushTouch(current, tapEvents(request.params));
      return OK;
    case 'drag':
      pushTouch(current, dragEvents(request.params.from, request.params.to, request.params.steps));
      return OK;
    case 'snapshot.save':
      return current.session.save();
    case 'snapshot.load': {
      const restored = await current.session.restore();
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
      runtime?.session.machine.touch.push(message.event);
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
      // tap·drag는 터치처럼 바로 넣고, 나머지는 start·save·reset과 겹치지 않게 줄 세운다.
      if (request.method === 'tap' || request.method === 'drag') void serve(request);
      else enqueue(() => serve(request));
      break;
    }
  }
};
