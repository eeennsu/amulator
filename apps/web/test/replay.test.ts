import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAG_STEPS_MAX } from '@amulator/core/control/protocol';

import type { Gesture } from '../src/messages';
import { parseRecording, playRecording } from '../src/replay';

const TAP: Gesture = { kind: 'tap', at: { x: 10, y: 20 } };
const DRAG: Gesture = { kind: 'drag', from: { x: 0, y: 0 }, to: { x: 100, y: 200 }, steps: 8 };

const recordingAt = (...times: number[]) => ({
  version: 1,
  events: times.map((atMs) => ({ atMs, gesture: TAP })),
});

describe('parseRecording', () => {
  it('올바른 기록을 읽는다', () => {
    const json = {
      version: 1,
      events: [
        { atMs: 0, gesture: TAP },
        { atMs: 120, gesture: DRAG },
      ],
    };

    expect(parseRecording(json)).toEqual(json);
  });

  it('시간이 거꾸로 가는 기록은 거부한다', () => {
    expect(() => parseRecording(recordingAt(100, 50))).toThrow();
  });

  it('같은 시각이 이어지는 기록은 받는다', () => {
    expect(() => parseRecording(recordingAt(100, 100))).not.toThrow();
  });

  it('화면 밖 좌표와 너무 많은 steps는 거부한다', () => {
    const offScreen = {
      version: 1,
      events: [{ atMs: 0, gesture: { kind: 'tap', at: { x: 400, y: 0 } } }],
    };
    const tooManySteps = {
      version: 1,
      events: [{ atMs: 0, gesture: { ...DRAG, steps: DRAG_STEPS_MAX + 1 } }],
    };

    expect(() => parseRecording(offScreen)).toThrow();
    expect(() => parseRecording(tooManySteps)).toThrow();
  });
});

describe('playRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('기록된 시각에 차례대로 보낸다', () => {
    const send = vi.fn();
    const recording = parseRecording({
      version: 1,
      events: [
        { atMs: 0, gesture: TAP },
        { atMs: 100, gesture: DRAG },
        { atMs: 250, gesture: TAP },
      ],
    });

    playRecording(recording, send);
    vi.advanceTimersByTime(99);
    expect(send.mock.calls).toEqual([[TAP]]);

    vi.advanceTimersByTime(151);
    expect(send.mock.calls).toEqual([[TAP], [DRAG], [TAP]]);
  });

  it('취소하면 남은 것을 보내지 않는다', () => {
    const send = vi.fn();
    const cancel = playRecording(parseRecording(recordingAt(0, 100, 250)), send);

    vi.advanceTimersByTime(99);
    cancel();
    cancel();
    vi.advanceTimersByTime(1000);

    expect(send).toHaveBeenCalledTimes(1);
  });
});
