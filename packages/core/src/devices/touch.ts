import { z } from 'zod';

import { BusFault, type AccessWidth, type Device } from '../bus';
import { FB_HEIGHT, FB_WIDTH, TOUCH_BASE } from '../memoryMap';

export const TOUCH_QUEUE_DEPTH = 64;

const X_MAX = FB_WIDTH - 1;
const Y_MAX = FB_HEIGHT - 1;

export const touchStateSchema = z.object({
  queue: z
    .array(
      z.object({
        x: z.int().min(0).max(X_MAX),
        y: z.int().min(0).max(Y_MAX),
        down: z.boolean(),
      }),
    )
    .max(TOUCH_QUEUE_DEPTH),
});

export type TouchState = z.infer<typeof touchStateSchema>;

export type TouchSample = { x: number; y: number; down: boolean };

export type TouchDevice = Device & {
  push: (event: TouchSample) => void;
  readonly queueLength: number;
  saveState: () => TouchState;
  loadState: (state: TouchState) => void;
};

const TOUCH_SIZE = 0x14;
const WORD_BYTES = 4;

const REG = { count: 0x00, x: 0x04, y: 0x08, down: 0x0c, pop: 0x10 } as const;

const clamp = (value: number, max: number): number => Math.min(Math.max(Math.trunc(value), 0), max);

// shortcut: 인터럽트를 만들지 않는다, 게스트가 wfi로 터치를 기다려야 할 때 MEIP 연결과 함께 더한다
export const createTouchDevice = (): TouchDevice => {
  const queue: TouchSample[] = [];

  // 맨 앞 이벤트가 없으면 모든 필드가 0이다.
  const read = (offset: number, width: AccessWidth): number => {
    if (width !== WORD_BYTES) throw new BusFault(TOUCH_BASE + offset, 'read');
    const head = queue[0];
    switch (offset) {
      case REG.count:
        return queue.length;
      case REG.x:
        return head?.x ?? 0;
      case REG.y:
        return head?.y ?? 0;
      case REG.down:
        return head?.down ? 1 : 0;
      default:
        return 0;
    }
  };

  // POP 외의 레지스터 쓰기는 무시한다.
  const write = (offset: number, width: AccessWidth): void => {
    if (width !== WORD_BYTES) throw new BusFault(TOUCH_BASE + offset, 'write');
    if (offset === REG.pop) queue.shift();
  };

  const push = (event: TouchSample): void => {
    if (queue.length >= TOUCH_QUEUE_DEPTH) queue.shift();
    queue.push({
      x: clamp(event.x, FB_WIDTH - 1),
      y: clamp(event.y, FB_HEIGHT - 1),
      down: event.down,
    });
  };

  return {
    name: 'touch',
    base: TOUCH_BASE,
    size: TOUCH_SIZE,
    read,
    write,
    push,
    get queueLength() {
      return queue.length;
    },
    saveState: () => ({ queue: queue.map((sample) => ({ ...sample })) }),
    loadState: (state) => {
      queue.length = 0;
      for (const sample of state.queue) queue.push({ ...sample });
    },
  };
};
