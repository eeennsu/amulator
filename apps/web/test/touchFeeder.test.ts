import { describe, expect, it } from 'vitest';

import { dragEvents, tapEvents } from '@amulator/core/control/gestures';
import {
  createTouchDevice,
  TOUCH_QUEUE_DEPTH,
  type TouchDevice,
  type TouchSample,
} from '@amulator/core/devices/touch';

import { createTouchFeeder } from '../src/worker/touchFeeder';

const REG = { x: 0x04, y: 0x08, down: 0x0c, pop: 0x10 } as const;
const WORD = 4;
const DRAG_STEPS = 100;
const DRAIN_PER_TICK = 10;

// 게스트가 하듯 맨 앞 샘플을 읽고 POP한다.
const consume = (device: TouchDevice, count: number): TouchSample[] => {
  const popped: TouchSample[] = [];
  while (popped.length < count && device.queueLength > 0) {
    popped.push({
      x: device.read(REG.x, WORD),
      y: device.read(REG.y, WORD),
      down: device.read(REG.down, WORD) === 1,
    });
    device.write(REG.pop, WORD, 1);
  }
  return popped;
};

// 한 틱마다 먹이고 count개를 소비한다. 모든 샘플이 소비될 때까지 반복해 순서대로 돌려준다.
const drainAll = (
  feeder: ReturnType<typeof createTouchFeeder>,
  device: TouchDevice,
  perTick: number,
): TouchSample[] => {
  const popped: TouchSample[] = [];
  while (feeder.canFeed(device) || device.queueLength > 0) {
    feeder.feed(device);
    popped.push(...consume(device, perTick));
  }
  return popped;
};

const drag = dragEvents({ x: 0, y: 0 }, { x: 300, y: 450 }, DRAG_STEPS);

describe('터치 feeder', () => {
  it('큐 깊이를 넘는 100 step drag도 하나도 버리지 않고 순서대로 전달한다', () => {
    expect(drag.length).toBeGreaterThan(TOUCH_QUEUE_DEPTH);
    const device = createTouchDevice();
    const feeder = createTouchFeeder();
    feeder.enqueue(drag);
    feeder.feed(device);
    expect(device.queueLength).toBe(TOUCH_QUEUE_DEPTH);
    expect(drainAll(feeder, device, DRAIN_PER_TICK)).toEqual(drag);
  });

  it('연달아 넣은 제스처는 넣은 순서를 지킨다', () => {
    const device = createTouchDevice();
    const feeder = createTouchFeeder();
    const taps = tapEvents({ x: 5, y: 6 });
    const human = [{ x: 7, y: 8, down: true }];
    feeder.enqueue(taps);
    feeder.enqueue(drag);
    feeder.enqueue(human);
    feeder.enqueue(taps);
    expect(drainAll(feeder, device, DRAIN_PER_TICK)).toEqual([...taps, ...drag, ...human, ...taps]);
  });

  it('device에 자리가 없거나 보낼 것이 없으면 canFeed가 false다', () => {
    const device = createTouchDevice();
    const feeder = createTouchFeeder();
    expect(feeder.canFeed(device)).toBe(false);
    feeder.enqueue(drag);
    expect(feeder.canFeed(device)).toBe(true);
    feeder.feed(device);
    expect(feeder.canFeed(device)).toBe(false);
    consume(device, 1);
    expect(feeder.canFeed(device)).toBe(true);
  });

  it('제스처는 그 샘플이 모두 소비된 뒤에야 끝난 것으로 본다', () => {
    const device = createTouchDevice();
    const feeder = createTouchFeeder();
    const tapTicket = feeder.enqueue(tapEvents({ x: 1, y: 1 }));
    const dragTicket = feeder.enqueue(drag);
    expect(feeder.isConsumed(tapTicket, device)).toBe(false); // 아직 device에 넣지도 않았다

    feeder.feed(device);
    expect(feeder.isConsumed(tapTicket, device)).toBe(false);

    consume(device, 1);
    expect(feeder.isConsumed(tapTicket, device)).toBe(false);
    consume(device, 1);
    expect(feeder.isConsumed(tapTicket, device)).toBe(true);
    expect(feeder.isConsumed(dragTicket, device)).toBe(false);

    // drag 샘플이 전부 device에 들어가도 소비되기 전에는 끝나지 않는다.
    while (feeder.canFeed(device) || device.queueLength > 1) {
      feeder.feed(device);
      consume(device, 1);
      expect(feeder.isConsumed(dragTicket, device)).toBe(false);
    }
    consume(device, 1);
    expect(device.queueLength).toBe(0);
    expect(feeder.isConsumed(dragTicket, device)).toBe(true);
  });

  it('끝난 제스처는 뒤따르는 샘플이 들어와도 끝난 채로 남는다', () => {
    const device = createTouchDevice();
    const feeder = createTouchFeeder();
    const ticket = feeder.enqueue(tapEvents({ x: 1, y: 1 }));
    feeder.feed(device);
    consume(device, 2);
    feeder.enqueue([{ x: 9, y: 9, down: true }]);
    feeder.feed(device);
    expect(device.queueLength).toBe(1);
    expect(feeder.isConsumed(ticket, device)).toBe(true);
  });

  it('clear는 보낼 것을 버리고, device에 남은 샘플이 있어도 새 제스처를 정확히 판정한다', () => {
    const device = createTouchDevice();
    const feeder = createTouchFeeder();
    feeder.enqueue(drag);
    feeder.feed(device);
    feeder.clear();
    expect(feeder.canFeed(device)).toBe(false);

    const leftover = 4;
    consume(device, TOUCH_QUEUE_DEPTH - leftover);
    const ticket = feeder.enqueue(tapEvents({ x: 2, y: 2 }));
    feeder.feed(device);
    expect(device.queueLength).toBe(leftover + 2);
    consume(device, leftover);
    expect(feeder.isConsumed(ticket, device)).toBe(false);
    consume(device, 1);
    expect(feeder.isConsumed(ticket, device)).toBe(false);
    consume(device, 1);
    expect(feeder.isConsumed(ticket, device)).toBe(true);
  });
});
