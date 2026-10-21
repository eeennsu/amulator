import { describe, expect, it } from 'vitest';

import type { DeviceAccess } from '@amulator/core/bus';

import { createTraceBuffer } from '../src/worker/traceBuffer';

const access = (value: number): DeviceAccess => ({
  device: 'touch',
  address: 0,
  width: 4,
  kind: 'read',
  value,
});

describe('traceBuffer', () => {
  it('최근 항목만 남기고 버린 수를 센다', () => {
    const buffer = createTraceBuffer(4);
    for (let value = 0; value < 10; value += 1) buffer.push(access(value));
    expect(buffer.drain()).toEqual({
      accesses: [6, 7, 8, 9].map(access),
      dropped: 6,
    });
    expect(buffer.drain()).toEqual({ accesses: [], dropped: 0 });
  });
});
