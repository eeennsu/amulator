import { TOUCH_QUEUE_DEPTH, type TouchSample } from '@amulator/core/devices/touch';

export type TouchSink = { push: (sample: TouchSample) => void; readonly queueLength: number };

export type TouchFeeder = {
  // 샘플을 줄 세우고 티켓(지금까지 넣은 샘플 수)을 돌려준다.
  enqueue: (samples: TouchSample[]) => number;
  // device에 자리가 있는 만큼 줄 선 샘플을 넣는다.
  feed: (device: TouchSink) => void;
  canFeed: (device: TouchSink) => boolean;
  // 티켓까지의 샘플을 게스트가 모두 꺼냈는지 본다.
  isConsumed: (ticket: number, device: TouchSink) => boolean;
  clear: () => void;
};

// device 큐는 깊이가 정해져 있고 가득 차면 가장 오래된 샘플을 버린다. 그래서 자리가 날 때마다 나눠 넣는다.
export const createTouchFeeder = (): TouchFeeder => {
  const pending: TouchSample[] = [];
  let enqueued = 0;
  let fed = 0;

  const canFeed = (device: TouchSink): boolean =>
    pending.length > 0 && device.queueLength < TOUCH_QUEUE_DEPTH;

  return {
    enqueue: (samples) => {
      pending.push(...samples);
      enqueued += samples.length;
      return enqueued;
    },
    feed: (device) => {
      while (canFeed(device)) {
        const sample = pending.shift();
        if (sample === undefined) return;
        device.push(sample);
        fed += 1;
      }
    },
    canFeed,
    // 큐는 FIFO라서, 티켓의 마지막 샘플을 꺼냈다면 큐에는 그 뒤에 넣은 샘플(fed - ticket개)만 남는다.
    // clear 전에 넣은 샘플이 앞에 남아 있어도 그것들은 티켓보다 먼저 나가므로 이 식이 그대로 맞다.
    isConsumed: (ticket, device) => device.queueLength <= fed - ticket,
    clear: () => {
      pending.length = 0;
      enqueued = 0;
      fed = 0;
    },
  };
};
