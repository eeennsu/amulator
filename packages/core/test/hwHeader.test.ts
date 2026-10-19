import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as memoryMap from '../src/memoryMap';

const HW_H = resolve(import.meta.dirname, '../../../guest/baremetal/hw.h');
const DEFINE = /^#define\s+(\w+)\s+(0x[0-9a-fA-F]+|\d+)u?\s*(?:\/\*.*)?$/gm;

// hw.h의 나머지 매크로(레지스터 offset, CSR 비트)는 memoryMap.ts에 짝이 없어 비교하지 않는다.
const SHARED_NAMES = [
  'RAM_BASE',
  'RAM_SIZE',
  'UART_BASE',
  'CLINT_BASE',
  'FB_BASE',
  'TOUCH_BASE',
  'FB_WIDTH',
  'FB_HEIGHT',
  'FB_STRIDE',
  'TIMEBASE_HZ',
] as const;

const defines = new Map(
  [...readFileSync(HW_H, 'utf8').matchAll(DEFINE)].map(([, name, value]) => [name, Number(value)]),
);

describe('hw.h', () => {
  it.each(SHARED_NAMES)('%s가 memoryMap.ts와 같은 값이다', (name) => {
    expect(defines.get(name)).toBe(memoryMap[name]);
  });
});
