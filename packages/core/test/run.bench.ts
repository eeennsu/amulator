import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createMachine } from '../src/machine';

const GUEST_OUT = resolve(import.meta.dirname, '../../../guest/baremetal/out');
const RUN_INSTRUCTIONS = 1_000_000;

// 그림판은 wfi 없이 터치 장치를 폴링하므로 장치 경로를 많이 지난다.
const machine = createMachine({ clock: { nowMicros: () => 0 }, onUartTransmit: () => undefined });
machine.loadElf(new Uint8Array(readFileSync(resolve(GUEST_OUT, 'paint.elf'))));

describe('run', () => {
  test('paint.elf 100만 명령어', async ({ bench }) => {
    await bench('paint.elf 100만 명령어', () => {
      expect(machine.run(RUN_INSTRUCTIONS).executed).toBe(RUN_INSTRUCTIONS);
    }).run();
  });
});
