import { z } from 'zod';

import { dragEvents, tapEvents } from '@amulator/core/control/gestures';
import { BRIDGE_ERROR_CODE, type BridgeRequest } from '@amulator/core/control/protocol';
import type { TouchSample } from '@amulator/core/devices/touch';
import type { ElfImage } from '@amulator/core/elf';
import { inspectCpu, memoryRegions, peekMemory, summarizeElf } from '@amulator/core/inspect';
import type { Machine } from '@amulator/core/machine';
import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';
import { describeSnapshot, serializeSnapshot } from '@amulator/core/snapshot';

import type { Gesture, MachineView, MainToWorker, RegisterTarget, WorkerToMain } from '../messages';
import { PROGRAMS, type ProgramName } from '../programs';
import { gestureSchema } from '../replay';
import { gzip } from './compression';
import { createHttpSnapshotStore } from './httpSnapshotStore';
import { createSession, type Session } from './session';
import {
  createIndexedDbSnapshotStore,
  createMemorySnapshotStore,
  type SnapshotStore,
} from './snapshotStore';
import { createTouchFeeder, type TouchSink } from './touchFeeder';
import { createTraceBuffer, TRACE_CAPACITY } from './traceBuffer';

// 한 구간이 메인 스레드 메시지(터치, 저장)를 막는 시간의 상한이다.
const SLICE_MS = 12;
const CLOCK_CHECK_INSTRUCTIONS = 10_000;
const IDLE_MIN_MS = 1;
const IDLE_MAX_MS = 16;
const MS_PER_SECOND = 1_000;
const STATUS_INTERVAL_MS = MS_PER_SECOND;
const MICROS_PER_MS = 1_000;
const TOUCH_TIMEOUT_MS = 2_000;
const STEP_MAX = 10_000;

type Runtime = {
  session: Session;
  context: OffscreenCanvasRenderingContext2D;
  image: ImageData;
  elf: ElfImage;
  imageHash: string;
};

// 브리지의 tap·drag 응답은 게스트가 그 샘플을 모두 꺼낸 뒤에 보낸다.
type TouchWaiter = {
  ticket: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const post = (message: WorkerToMain, transfer: Transferable[] = []): void =>
  self.postMessage(message, { transfer });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

let runtime: Runtime | undefined;
let pendingOutput: number[] = [];
let executed = 0;
let statusSince = performance.now();
let sliceQueued = false;
let paused = false;
let breakpoint: number | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let tasks: Promise<void> = Promise.resolve();
const touchFeeder = createTouchFeeder();
let touchWaiters: TouchWaiter[] = [];
let traceEnabled = false;
const traceBuffer = createTraceBuffer(TRACE_CAPACITY);

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

// 머신이 바뀔 때마다 새 버스에 다시 건다. 끄면 듣는 함수를 뗀다.
const attachTrace = (): void => {
  runtime?.session.machine.bus.setDeviceAccessListener(traceEnabled ? traceBuffer.push : undefined);
};

const flushTrace = (): void => {
  const { accesses, dropped } = traceBuffer.drain();
  if (accesses.length > 0) post({ type: 'deviceAccesses', accesses, dropped });
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
    let hitBreak = false;
    // 게스트가 쉬어도 줄 선 터치를 넣을 자리가 있으면 바로 이어서 먹인다(자리가 없으면 쉰다).
    const hasWork = (): boolean => !idle || touchFeeder.canFeed(machine.touch);
    while (!hitBreak && hasWork() && performance.now() < deadline) {
      touchFeeder.feed(machine.touch);
      const result = machine.run(CLOCK_CHECK_INSTRUCTIONS, breakpoint);
      executed += result.executed;
      idle = result.idle;
      hitBreak = result.hitBreak;
    }
    settleTouch(machine.touch);
    draw(runtime);
    flushOutput();
    flushTrace();
    reportStatus(performance.now());
    if (hitBreak) {
      // 걸리면 꺼지고 멈춘다. 다음 구간은 예약하지 않으므로 resume이 다시 건다.
      breakpoint = undefined;
      pause();
      postState(runtime);
      return;
    }
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
    flushTrace();
    post({ type: 'error', message: `실행을 멈췄다: ${messageOf(error)}` });
  }
};

channel.port1.onmessage = () => {
  sliceQueued = false;
  runSlice();
};

// persist가 false면 메모리, 아니면 token이 있는 MCP 모드는 로컬 서버의 디스크, 없으면 IndexedDB다.
const pickStore = (token: string | undefined, persist: boolean): SnapshotStore => {
  if (!persist) return createMemorySnapshotStore();
  return token === undefined ? createIndexedDbSnapshotStore() : createHttpSnapshotStore(token);
};

const start = async (
  program: ProgramName,
  canvas: OffscreenCanvas,
  token: string | undefined,
  persist: boolean,
): Promise<void> => {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas 2d 컨텍스트를 만들 수 없다');
  const response = await fetch(PROGRAMS[program]);
  if (!response.ok) throw new Error(`${program} 프로그램을 받지 못했다: HTTP ${response.status}`);
  breakpoint = undefined;
  const session = createSession({
    store: pickStore(token, persist),
    clock: { nowMicros: () => performance.now() * MICROS_PER_MS },
    onUartTransmit: (byte) => {
      pendingOutput.push(byte);
    },
  });
  const { restored, warning, image, imageHash } = await session.boot(
    new Uint8Array(await response.arrayBuffer()),
  );
  session.machine.framebuffer.dirty = true; // 게스트가 화면을 쓰지 않아도 첫 화면을 그린다
  runtime = { session, context, image: new ImageData(FB_WIDTH, FB_HEIGHT), elf: image, imageHash };
  attachTrace();
  cancelTouch();
  post({
    type: 'booted',
    restored,
    warning,
    elf: summarizeElf(image),
    regions: memoryRegions(session.machine),
  });
  restartLoop();
};

const save = async (): Promise<void> => {
  if (runtime === undefined) return;
  const { bytes } = await runtime.session.save();
  post({ type: 'saved', bytes });
};

const reset = async (): Promise<void> => {
  if (runtime === undefined) return;
  breakpoint = undefined;
  await runtime.session.reset();
  cancelTouch();
  runtime.session.machine.framebuffer.dirty = true;
  attachTrace();
  post({
    type: 'booted',
    restored: false,
    elf: summarizeElf(runtime.elf),
    regions: memoryRegions(runtime.session.machine),
  });
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
      attachTrace();
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

// 아직 부팅하지 않았거나 동작이 던지면 오류로 알린다. 던져도 워커는 다음 메시지에 응답한다.
const guarded = (action: (current: Runtime) => void, id?: number): void => {
  try {
    if (runtime === undefined) throw new Error('아직 부팅하지 않았다');
    action(runtime);
  } catch (error: unknown) {
    post({ type: 'error', message: messageOf(error), ...(id === undefined ? {} : { id }) });
  }
};

const postState = ({ session }: Runtime): void => {
  const view: MachineView = {
    paused,
    cpu: inspectCpu(session.machine.cpu),
    touch: session.machine.touch.saveState(),
  };
  post({ type: 'state', state: view });
};

// 멈춘 동안의 수동 동작이 만든 화면·출력·장치 접근을 runSlice가 하듯 내보낸다.
const publish = (current: Runtime): void => {
  settleTouch(current.session.machine.touch);
  draw(current);
  flushOutput();
  flushTrace();
};

const step = (current: Runtime, count: number): void => {
  if (!paused) throw new Error('멈춘 상태에서만 한 단계씩 실행할 수 있다');
  if (!Number.isInteger(count) || count < 1 || count > STEP_MAX) {
    throw new RangeError(`단계 수는 1~${STEP_MAX} 사이의 정수여야 한다: ${count}`);
  }
  const { machine } = current.session;
  touchFeeder.feed(machine.touch);
  try {
    machine.run(count);
  } finally {
    publish(current);
  }
  postState(current);
};

const writeRegister = ({ session }: Runtime, target: RegisterTarget, value: number): void => {
  const { cpu } = session.machine;
  if (target === 'pc') {
    cpu.pc = value >>> 0;
    cpu.idle = false;
    wake();
  } else if (!Number.isInteger(target) || target < 0 || target >= cpu.x.length) {
    throw new RangeError(`레지스터 번호는 0~${cpu.x.length - 1}이어야 한다: ${target}`);
  } else if (target !== 0) {
    cpu.x[target] = value >>> 0;
  }
};

const busWrite = (current: Runtime, address: number, width: number, value: number): void => {
  if (width !== 1 && width !== 2 && width !== 4) {
    throw new RangeError(`접근 폭은 1, 2, 4 중 하나여야 한다: ${width}`);
  }
  try {
    current.session.machine.bus.write(address, width, value);
  } finally {
    publish(current);
  }
  wake(); // 장치에 쓴 값이 쉬는 게스트를 깨울 수 있다
  postState(current);
};

// 기록 재생과 같은 스키마로 검사한다. steps 상한이 없으면 큰 값이 배열을 크게 만든다.
const gestureSamples = (gesture: Gesture): TouchSample[] => {
  const parsed = gestureSchema.safeParse(gesture);
  if (!parsed.success) throw new RangeError(z.prettifyError(parsed.error));
  const { data } = parsed;
  return data.kind === 'tap' ? tapEvents(data.at) : dragEvents(data.from, data.to, data.steps);
};

const describeCurrentSnapshot = async (id: number): Promise<void> => {
  try {
    if (runtime === undefined) throw new Error('아직 부팅하지 않았다');
    const bytes = serializeSnapshot(runtime.session.machine, runtime.imageHash);
    const { meta, sections } = describeSnapshot(bytes);
    const compressed = await gzip(bytes);
    post({ type: 'snapshotInfo', id, meta, sections, gzipBytes: compressed.length });
  } catch (error: unknown) {
    post({ type: 'error', message: messageOf(error), id });
  }
};

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'start':
      enqueue(() => start(message.program, message.canvas, message.token, message.persist));
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
    // 부팅 전에는 트레이스처럼 조용히 받는다. paused는 남아서 이어서 부팅한 머신이 멈춘 채 시작한다.
    case 'pause':
      pause();
      if (runtime !== undefined) postState(runtime);
      break;
    case 'resume':
      resume();
      if (runtime !== undefined) postState(runtime);
      break;
    case 'breakAt':
      breakpoint = message.address ?? undefined;
      break;
    case 'step':
      guarded((current) => step(current, message.count));
      break;
    case 'inspect':
      guarded(postState);
      break;
    case 'peek':
      guarded(({ session }) => {
        const bytes = peekMemory(session.machine, message.address, message.length);
        // peekMemory가 slice로 복사한 버퍼여야 한다. RAM의 뷰를 넘기면 머신 메모리가 detach된다.
        const transfer = bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
        post({ type: 'memory', id: message.id, address: message.address, bytes }, transfer);
      }, message.id);
      break;
    case 'setRegister':
      guarded((current) => {
        writeRegister(current, message.target, message.value);
        postState(current);
      });
      break;
    case 'busWrite':
      guarded((current) => busWrite(current, message.address, message.width, message.value));
      break;
    case 'trace':
      traceEnabled = message.enabled;
      if (!traceEnabled) traceBuffer.drain(); // 끄면 모인 기록은 보내지 않고 버린다
      attachTrace();
      break;
    case 'gesture':
      guarded(() => {
        touchFeeder.enqueue(gestureSamples(message.gesture));
        wake();
      });
      break;
    case 'describeSnapshot':
      enqueue(() => describeCurrentSnapshot(message.id));
      break;
  }
};
