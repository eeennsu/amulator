import type { Machine } from '@amulator/core/machine';
import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';

import type { MainToWorker, WorkerToMain } from '../messages';
import { PROGRAMS, type ProgramName } from '../programs';
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

const post = (message: WorkerToMain): void => self.postMessage(message);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

let runtime: Runtime | undefined;
let pendingOutput: number[] = [];
let executed = 0;
let statusSince = performance.now();
let sliceQueued = false;
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
  if (runtime === undefined) return;
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

const start = async (program: ProgramName, canvas: OffscreenCanvas): Promise<void> => {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas 2d 컨텍스트를 만들 수 없다');
  const response = await fetch(PROGRAMS[program]);
  if (!response.ok) throw new Error(`${program} 프로그램을 받지 못했다: HTTP ${response.status}`);
  const session = createSession({
    store: createIndexedDbSnapshotStore(),
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

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'start':
      enqueue(() => start(message.program, message.canvas));
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
  }
};
