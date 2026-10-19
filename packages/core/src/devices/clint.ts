import { BusFault, type AccessWidth, type Device } from '../bus';
import { CLINT_BASE } from '../memoryMap';

export type Clock = { nowMicros: () => number };

export type Clint = Device & {
  mtime: () => number;
  timerPending: () => boolean;
  softwarePending: () => boolean;
  mtimecmp: () => number;
};

const CLINT_SIZE = 0x1_0000;
const WORD_BYTES = 4;
const UINT32_RANGE = 0x1_0000_0000;
const UINT32_MAX = 0xffff_ffff;

const REG = {
  msip: 0x0,
  mtimecmpLo: 0x4000,
  mtimecmpHi: 0x4004,
  mtimeLo: 0xbff8,
  mtimeHi: 0xbffc,
} as const;

export const createClint = (clock: Clock): Clint => {
  const epoch = Math.floor(clock.nowMicros());
  let msip = 0;
  // 64비트 값을 32비트 둘로 들고 있어야 RV32 게스트가 반쪽씩 쓰는 순서를 따를 수 있다.
  let cmpLo = UINT32_MAX;
  let cmpHi = UINT32_MAX;

  const mtime = (): number => Math.floor(clock.nowMicros()) - epoch;
  const mtimecmp = (): number => cmpHi * UINT32_RANGE + cmpLo;

  const read = (offset: number, width: AccessWidth): number => {
    if (width !== WORD_BYTES) throw new BusFault(CLINT_BASE + offset, 'read');
    switch (offset) {
      case REG.msip:
        return msip;
      case REG.mtimecmpLo:
        return cmpLo;
      case REG.mtimecmpHi:
        return cmpHi;
      case REG.mtimeLo:
        return mtime() % UINT32_RANGE;
      case REG.mtimeHi:
        return Math.floor(mtime() / UINT32_RANGE);
      default:
        return 0;
    }
  };

  // mtime 쓰기는 무시한다: 시계가 곧 mtime이다.
  const write = (offset: number, width: AccessWidth, value: number): void => {
    if (width !== WORD_BYTES) throw new BusFault(CLINT_BASE + offset, 'write');
    switch (offset) {
      case REG.msip:
        msip = value & 1;
        break;
      case REG.mtimecmpLo:
        cmpLo = value >>> 0;
        break;
      case REG.mtimecmpHi:
        cmpHi = value >>> 0;
        break;
      default:
        break;
    }
  };

  return {
    name: 'clint',
    base: CLINT_BASE,
    size: CLINT_SIZE,
    read,
    write,
    mtime,
    mtimecmp,
    timerPending: () => mtime() >= mtimecmp(),
    softwarePending: () => msip === 1,
  };
};
