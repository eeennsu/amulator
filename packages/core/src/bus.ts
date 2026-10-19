import { RAM_BASE } from './memoryMap';

export type AccessWidth = 1 | 2 | 4;
export type AccessKind = 'read' | 'write' | 'fetch';

export type Device = {
  readonly name: string; // 'uart16550', 'clint' 등. 스냅샷의 장치 구성 비교에 쓴다
  readonly base: number;
  readonly size: number;
  read: (offset: number, width: AccessWidth) => number;
  write: (offset: number, width: AccessWidth, value: number) => void;
};

export class BusFault extends Error {
  override name = 'BusFault';

  constructor(
    readonly address: number,
    readonly access: AccessKind,
  ) {
    super(`버스 오류: ${access} 0x${address.toString(16)}`);
  }
}

export type Bus = {
  readonly ram: Uint8Array;
  read: (address: number, width: AccessWidth) => number; // 부호 없는 값(>>> 0)
  write: (address: number, width: AccessWidth, value: number) => void;
  fetch: (address: number) => number;
};

const FETCH_WIDTH = 4;

// 장치가 폭에 맞는 값만 받도록 RAM의 암묵적 절단과 같게 맞춘다.
const truncate = (value: number, width: AccessWidth): number =>
  width === 4 ? value >>> 0 : value & ((1 << (width * 8)) - 1);

export const createBus = (ram: Uint8Array, devices: readonly Device[]): Bus => {
  const view = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);

  const ramOffset = (address: number, width: AccessWidth): number | undefined => {
    const offset = address - RAM_BASE;
    return offset >= 0 && offset + width <= ram.length ? offset : undefined;
  };

  const deviceAt = (address: number, width: AccessWidth): Device | undefined =>
    devices.find(
      (device) =>
        address >= device.base &&
        address - device.base + width <= device.size &&
        address % width === 0,
    );

  const read = (rawAddress: number, width: AccessWidth): number => {
    const address = rawAddress >>> 0;
    const offset = ramOffset(address, width);
    if (offset !== undefined) {
      if (width === 1) return view.getUint8(offset);
      if (width === 2) return view.getUint16(offset, true);
      return view.getUint32(offset, true);
    }
    const device = deviceAt(address, width);
    if (device === undefined) throw new BusFault(address, 'read');
    return device.read(address - device.base, width) >>> 0;
  };

  const write = (rawAddress: number, width: AccessWidth, value: number): void => {
    const address = rawAddress >>> 0;
    const offset = ramOffset(address, width);
    if (offset !== undefined) {
      if (width === 1) view.setUint8(offset, value);
      else if (width === 2) view.setUint16(offset, value, true);
      else view.setUint32(offset, value, true);
      return;
    }
    const device = deviceAt(address, width);
    if (device === undefined) throw new BusFault(address, 'write');
    device.write(address - device.base, width, truncate(value, width));
  };

  // 명령어는 RAM에서만 가져온다. 장치 읽기는 부작용이 있다(UART FIFO 소비 등).
  const fetch = (rawAddress: number): number => {
    const address = rawAddress >>> 0;
    const offset = ramOffset(address, FETCH_WIDTH);
    if (offset === undefined) throw new BusFault(address, 'fetch');
    return view.getUint32(offset, true);
  };

  return { ram, read, write, fetch };
};
