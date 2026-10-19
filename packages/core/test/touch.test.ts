import { describe, expect, it } from 'vitest';

import { BusFault } from '../src/bus';
import { createTouchDevice, TOUCH_QUEUE_DEPTH } from '../src/devices/touch';

const COUNT = 0x00;
const X = 0x04;
const Y = 0x08;
const DOWN = 0x0c;
const POP = 0x10;

describe('터치 장치', () => {
  it('push한 이벤트를 COUNT·X·Y·DOWN으로 읽는다', () => {
    const touch = createTouchDevice();
    touch.push({ x: 10, y: 20, down: true });
    expect(touch.queueLength).toBe(1);
    expect(touch.read(COUNT, 4)).toBe(1);
    expect(touch.read(X, 4)).toBe(10);
    expect(touch.read(Y, 4)).toBe(20);
    expect(touch.read(DOWN, 4)).toBe(1);
  });

  it('POP을 쓰면 맨 앞 하나를 꺼내고, 빈 큐의 DOWN은 0이다', () => {
    const touch = createTouchDevice();
    touch.push({ x: 10, y: 20, down: true });
    touch.write(POP, 4, 1);
    expect(touch.read(COUNT, 4)).toBe(0);
    expect(touch.read(DOWN, 4)).toBe(0);
    expect(touch.read(X, 4)).toBe(0);
  });

  it('맨 앞 이벤트만 보이고, 읽기는 큐를 줄이지 않는다', () => {
    const touch = createTouchDevice();
    touch.push({ x: 1, y: 2, down: true });
    touch.push({ x: 3, y: 4, down: false });
    expect(touch.read(X, 4)).toBe(1);
    expect(touch.read(X, 4)).toBe(1);
    touch.write(POP, 4, 0);
    expect(touch.read(X, 4)).toBe(3);
    expect(touch.read(Y, 4)).toBe(4);
    expect(touch.read(DOWN, 4)).toBe(0);
  });

  it('좌표를 화면 안으로 자른다', () => {
    const touch = createTouchDevice();
    touch.push({ x: -5, y: 999, down: true });
    expect(touch.read(X, 4)).toBe(0);
    expect(touch.read(Y, 4)).toBe(479);
    touch.write(POP, 4, 1);
    touch.push({ x: 999, y: -5, down: false });
    expect(touch.read(X, 4)).toBe(319);
    expect(touch.read(Y, 4)).toBe(0);
  });

  it('큐가 차면 가장 오래된 이벤트를 버린다', () => {
    const touch = createTouchDevice();
    for (let index = 0; index <= TOUCH_QUEUE_DEPTH; index += 1) {
      touch.push({ x: index, y: 0, down: true });
    }
    expect(touch.read(COUNT, 4)).toBe(TOUCH_QUEUE_DEPTH);
    expect(touch.read(X, 4)).toBe(1);
  });

  it('읽기 전용 레지스터 쓰기는 무시하고 POP 읽기는 0이다', () => {
    const touch = createTouchDevice();
    touch.push({ x: 10, y: 20, down: true });
    touch.write(COUNT, 4, 0);
    touch.write(X, 4, 0);
    touch.write(DOWN, 4, 0);
    expect(touch.read(POP, 4)).toBe(0);
    expect(touch.read(COUNT, 4)).toBe(1);
    expect(touch.read(X, 4)).toBe(10);
  });

  it('32비트가 아닌 접근은 접근 오류다', () => {
    const touch = createTouchDevice();
    expect(() => touch.read(COUNT, 1)).toThrow(BusFault);
    expect(() => touch.write(POP, 2, 1)).toThrow(BusFault);
  });
});
