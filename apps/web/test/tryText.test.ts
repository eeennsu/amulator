import { describe, expect, it } from 'vitest';

import { hintText, resultText } from '../src/chapter/tryText';

const A2 = 12;
const REGISTER_COUNT = 32;

const view = (pc: number, a2 = 0, paused = true) => {
  const x = Array.from({ length: REGISTER_COUNT }, () => 0);
  x[A2] = a2;
  return { paused, cpu: { pc, x } };
};

describe('hintText', () => {
  it('명령어 하나를 실행하는 동작', () => {
    expect(hintText({ label: 'x', kind: 'step', count: 1 })).toBe(
      '누르면 왼쪽 에뮬레이터가 명령어 하나를 실행한다',
    );
  });

  it('명령어 여럿을 실행하는 동작', () => {
    expect(hintText({ label: 'x', kind: 'step', count: 4 })).toBe(
      '누르면 왼쪽 에뮬레이터가 명령어 4개를 실행한다',
    );
  });

  it('주소까지 실행하는 동작은 8자리 16진수를 쓴다', () => {
    expect(hintText({ label: 'x', kind: 'runTo', address: 0x8000_004c, expect: 'addi' })).toBe(
      '누르면 왼쪽 에뮬레이터가 8000004c에 올 때까지 실행하고 멈춘다',
    );
  });

  it('레지스터를 바꾸는 동작은 ABI 이름과 값을 쓴다', () => {
    expect(hintText({ label: 'x', kind: 'setRegister', target: A2, value: 12_345 })).toBe(
      '누르면 왼쪽 레지스터 a2 값을 12345로 바꾼다',
    );
  });
});

describe('resultText', () => {
  it('pc가 바뀐 앞뒤를 보인다', () => {
    const action = { label: '명령어 1개 실행', kind: 'step', count: 1 } as const;
    expect(resultText(action, view(0x8000_0000), view(0x8000_0004))).toBe(
      '✓ 방금: 명령어 1개 실행 — pc 80000000 → 80000004',
    );
  });

  it('레지스터를 바꾸면 새 값을 덧붙인다', () => {
    const action = {
      label: 'a2를 12345로 고치기',
      kind: 'setRegister',
      target: A2,
      value: 12_345,
    } as const;
    expect(resultText(action, view(0x8000_0154), view(0x8000_0154, 12_345))).toBe(
      '✓ 방금: a2를 12345로 고치기 — pc 80000154 → 80000154, a2 00003039',
    );
  });

  it('앞 상태가 멈춘 상태가 아니면 뒤 pc만 보인다', () => {
    const action = {
      label: 'trap_entry까지 실행',
      kind: 'runTo',
      address: 0x8000_004c,
      expect: 'addi',
    } as const;
    expect(resultText(action, view(0x8000_0200, 0, false), view(0x8000_004c))).toBe(
      '✓ 방금: trap_entry까지 실행 — pc 8000004c',
    );
    expect(resultText(action, undefined, view(0x8000_004c))).toBe(
      '✓ 방금: trap_entry까지 실행 — pc 8000004c',
    );
  });
});
