import { describe, expect, it } from 'vitest';

import { BusFault } from '../src/bus';
import { createClint } from '../src/devices/clint';

const MSIP = 0x0;
const MTIMECMP_LO = 0x4000;
const MTIMECMP_HI = 0x4004;
const MTIME_LO = 0xbff8;
const MTIME_HI = 0xbffc;
const ALL_ONES = 0xffff_ffff;

// 시계는 테스트가 직접 움직인다. 시작 값이 0이 아니어도 mtime은 생성 시점부터 센다.
const setup = (start = 0) => {
  const state = { now: start };
  const clint = createClint({ nowMicros: () => state.now });
  return { state, clint };
};

describe('CLINT mtime', () => {
  it('생성 시점의 mtime은 0이고 시계가 가는 만큼 오른다', () => {
    const { state, clint } = setup(1_000);
    expect(clint.mtime()).toBe(0);
    state.now = 3_500;
    expect(clint.mtime()).toBe(2_500);
  });

  it('하위·상위 32비트를 offset 0xBFF8·0xBFFC로 읽는다', () => {
    const { state, clint } = setup();
    state.now = 0x1_0000_0005;
    expect(clint.read(MTIME_LO, 4)).toBe(5);
    expect(clint.read(MTIME_HI, 4)).toBe(1);
  });

  it('mtime 쓰기는 무시한다', () => {
    const { state, clint } = setup();
    state.now = 100;
    clint.write(MTIME_LO, 4, 0);
    expect(clint.mtime()).toBe(100);
  });
});

describe('CLINT mtimecmp', () => {
  it('초기값은 상하위 모두 0xFFFF_FFFF이고 타이머는 대기하지 않는다', () => {
    const { state, clint } = setup();
    state.now = 10_000_000;
    expect(clint.read(MTIMECMP_LO, 4)).toBe(ALL_ONES);
    expect(clint.read(MTIMECMP_HI, 4)).toBe(ALL_ONES);
    expect(clint.timerPending()).toBe(false);
  });

  it('mtime이 mtimecmp에 닿으면 대기한다', () => {
    const { state, clint } = setup();
    clint.write(MTIMECMP_HI, 4, 0);
    clint.write(MTIMECMP_LO, 4, 1_000);
    expect(clint.mtimecmp()).toBe(1_000);
    state.now = 999;
    expect(clint.timerPending()).toBe(false);
    state.now = 1_000;
    expect(clint.timerPending()).toBe(true);
  });

  it('상위 워드까지 합쳐 비교한다', () => {
    const { state, clint } = setup();
    clint.write(MTIMECMP_HI, 4, 1);
    clint.write(MTIMECMP_LO, 4, 0);
    state.now = ALL_ONES;
    expect(clint.timerPending()).toBe(false);
    state.now = 0x1_0000_0000;
    expect(clint.timerPending()).toBe(true);
  });
});

describe('CLINT msip', () => {
  it('offset 0의 0번 비트가 softwarePending이다', () => {
    const { clint } = setup();
    expect(clint.softwarePending()).toBe(false);
    clint.write(MSIP, 4, 0xffff_fffe);
    expect(clint.softwarePending()).toBe(false);
    clint.write(MSIP, 4, 1);
    expect(clint.softwarePending()).toBe(true);
    expect(clint.read(MSIP, 4)).toBe(1);
  });
});

describe('CLINT 접근 폭', () => {
  it('32비트가 아닌 접근은 접근 오류다', () => {
    const { clint } = setup();
    expect(() => clint.read(MSIP, 1)).toThrow(BusFault);
    expect(() => clint.write(MSIP, 2, 1)).toThrow(BusFault);
  });
});
