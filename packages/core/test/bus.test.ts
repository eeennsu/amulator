import { describe, expect, it } from 'vitest';

import { BusFault, createBus, type AccessWidth, type Device } from '../src/bus';
import { RAM_BASE } from '../src/memoryMap';

const RAM_BYTES = 0x1000;
const DEVICE_BASE = 0x1000_0000;
const DEVICE_SIZE = 0x100;

type DeviceCall = { offset: number; width: AccessWidth; value: number };

const makeDevice = (readValue = 0) => {
  const writes: DeviceCall[] = [];
  const device: Device = {
    name: 'fake',
    base: DEVICE_BASE,
    size: DEVICE_SIZE,
    read: () => readValue,
    write: (offset, width, value) => {
      writes.push({ offset, width, value });
    },
  };
  return { device, writes };
};

const makeBus = (devices: readonly Device[] = []) => createBus(new Uint8Array(RAM_BYTES), devices);

const catchFault = (run: () => void): BusFault => {
  try {
    run();
  } catch (error) {
    if (error instanceof BusFault) return error;
    throw error;
  }
  throw new Error('BusFault가 던져지지 않았다');
};

describe('bus RAM', () => {
  it('리틀엔디언으로 읽고 쓴다', () => {
    const bus = makeBus();
    bus.write(RAM_BASE, 4, 0x1122_3344);
    expect(bus.read(RAM_BASE, 1)).toBe(0x44);
    expect(bus.read(RAM_BASE, 2)).toBe(0x3344);
    expect(bus.read(RAM_BASE, 4)).toBe(0x1122_3344);
  });

  it('RAM 안에서 정렬되지 않은 접근도 바이트 순서대로 읽힌다', () => {
    const bus = makeBus();
    bus.write(RAM_BASE, 4, 0x1122_3344);
    bus.write(RAM_BASE + 4, 4, 0x5566_7788);
    expect(bus.read(RAM_BASE + 1, 4)).toBe(0x8811_2233);
  });

  it('읽은 값은 부호 없는 수다', () => {
    const bus = makeBus();
    bus.write(RAM_BASE, 4, -1);
    expect(bus.read(RAM_BASE, 4)).toBe(0xffff_ffff);
  });

  it('RAM 끝을 넘는 접근은 BusFault다', () => {
    const bus = makeBus();
    expect(catchFault(() => bus.read(RAM_BASE + RAM_BYTES - 2, 4)).address).toBe(
      RAM_BASE + RAM_BYTES - 2,
    );
    expect(catchFault(() => bus.write(RAM_BASE + RAM_BYTES, 1, 0)).access).toBe('write');
  });

  it('fetch는 4바이트를 읽는다', () => {
    const bus = makeBus();
    bus.write(RAM_BASE + 8, 4, 0x0000_0013);
    expect(bus.fetch(RAM_BASE + 8)).toBe(0x0000_0013);
  });
});

describe('bus 장치', () => {
  it('장치에는 base를 뺀 offset과 값이 전달된다', () => {
    const { device, writes } = makeDevice();
    const bus = makeBus([device]);
    bus.write(DEVICE_BASE + 4, 1, 7);
    expect(writes).toEqual([{ offset: 4, width: 1, value: 7 }]);
  });

  it('장치에는 접근 폭만큼 자른 값이 전달된다', () => {
    const { device, writes } = makeDevice();
    const bus = makeBus([device]);
    bus.write(DEVICE_BASE, 1, 0x1ff);
    bus.write(DEVICE_BASE, 4, -1);
    expect(writes.map((call) => call.value)).toEqual([0xff, 0xffff_ffff]);
  });

  it('장치가 돌려준 값은 부호 없는 수로 바뀐다', () => {
    const { device } = makeDevice(-1);
    const bus = makeBus([device]);
    expect(bus.read(DEVICE_BASE, 4)).toBe(0xffff_ffff);
  });

  it('장치에 정렬되지 않은 접근을 하면 BusFault다', () => {
    const { device } = makeDevice();
    const bus = makeBus([device]);
    expect(catchFault(() => bus.read(DEVICE_BASE + 2, 4)).access).toBe('read');
    expect(catchFault(() => bus.write(DEVICE_BASE + 1, 2, 0)).access).toBe('write');
  });

  it('장치 영역 끝을 넘는 접근은 BusFault다', () => {
    const { device } = makeDevice();
    const bus = makeBus([device]);
    expect(catchFault(() => bus.read(DEVICE_BASE + DEVICE_SIZE, 1)).address).toBe(
      DEVICE_BASE + DEVICE_SIZE,
    );
  });
});

describe('bus 매핑되지 않은 주소', () => {
  it('read는 BusFault를 던지고 address와 access를 담는다', () => {
    const bus = makeBus();
    const fault = catchFault(() => bus.read(0x0, 4));
    expect(fault.address).toBe(0);
    expect(fault.access).toBe('read');
  });

  it('fetch는 access가 fetch다', () => {
    const bus = makeBus();
    expect(catchFault(() => bus.fetch(0x0)).access).toBe('fetch');
  });

  it('장치 영역을 fetch하면 BusFault다', () => {
    const { device } = makeDevice();
    const bus = makeBus([device]);
    expect(catchFault(() => bus.fetch(DEVICE_BASE)).access).toBe('fetch');
  });

  it('음수 주소는 부호 없는 수로 다룬다', () => {
    const bus = makeBus();
    expect(catchFault(() => bus.read(-4, 4)).address).toBe(0xffff_fffc);
  });
});
