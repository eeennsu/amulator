import { z } from 'zod';

import { DRAG_STEPS_MAX, pointSchema } from '@amulator/core/control/protocol';

import type { Gesture } from './messages';

const gestureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), at: pointSchema }),
  z.object({
    kind: z.literal('drag'),
    from: pointSchema,
    to: pointSchema,
    steps: z.int().min(1).max(DRAG_STEPS_MAX),
  }),
]) satisfies z.ZodType<Gesture>;

export const gestureRecordingSchema = z.object({
  version: z.literal(1),
  events: z
    .array(z.object({ atMs: z.number().min(0), gesture: gestureSchema }))
    .refine((events) => events.every((event, i) => event.atMs >= (events[i - 1]?.atMs ?? 0)), {
      message: 'atMs는 오름차순이어야 한다',
    }),
});

export type GestureRecording = z.infer<typeof gestureRecordingSchema>;

export const parseRecording = (json: unknown): GestureRecording =>
  gestureRecordingSchema.parse(json);

// 호출한 순간을 0ms로 삼아 이벤트마다 타이머를 건다. 반환값은 남은 타이머를 모두 지운다.
export const playRecording = (
  recording: GestureRecording,
  send: (gesture: Gesture) => void,
): (() => void) => {
  const timers = recording.events.map(({ atMs, gesture }) => setTimeout(() => send(gesture), atMs));

  return () => {
    timers.forEach((timer) => clearTimeout(timer));
  };
};
