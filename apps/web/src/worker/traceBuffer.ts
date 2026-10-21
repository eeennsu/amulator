import type { DeviceAccess } from '@amulator/core/bus';

export const TRACE_CAPACITY = 256;

export type TraceBuffer = {
  push: (access: DeviceAccess) => void;
  drain: () => { accesses: DeviceAccess[]; dropped: number };
};

// 가득 차면 가장 오래된 항목을 덮어쓴다. 게스트가 장치를 폴링하면 접근이 쏟아지므로 매번 앞을 당기지 않는다.
export const createTraceBuffer = (capacity: number): TraceBuffer => {
  let ring: DeviceAccess[] = [];
  let oldest = 0;
  let dropped = 0;
  return {
    push: (access) => {
      if (ring.length < capacity) {
        ring.push(access);
        return;
      }
      ring[oldest] = access;
      oldest = (oldest + 1) % capacity;
      dropped += 1;
    },
    drain: () => {
      const result = { accesses: [...ring.slice(oldest), ...ring.slice(0, oldest)], dropped };
      ring = [];
      oldest = 0;
      dropped = 0;
      return result;
    },
  };
};
