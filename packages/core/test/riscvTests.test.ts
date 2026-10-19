import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createMachine } from '../src/machine';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/riscv-tests');
const CHUNK = 10_000;
const MAX_INSTRUCTIONS = 1_000_000;

const SKIP_REASONS = ['s-mode', 'pmp', 'debug-trigger'] as const;
type Skip = { name: string; reason: (typeof SKIP_REASONS)[number]; deferredTo: string };

const isSkip = (value: unknown): value is Skip =>
  typeof value === 'object' &&
  value !== null &&
  'name' in value &&
  typeof value.name === 'string' &&
  'reason' in value &&
  SKIP_REASONS.some((reason) => reason === value.reason) &&
  'deferredTo' in value &&
  typeof value.deferredTo === 'string';

const readSkips = (): Skip[] => {
  const parsed: unknown = JSON.parse(readFileSync(resolve(FIXTURES, 'skip.json'), 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every(isSkip)) throw new Error('skip.json 형식이 틀렸다');
  return parsed;
};

// tohost에 0이 아닌 값이 쓰일 때까지 돌리고 그 값을 돌려준다. 끝나지 않으면 0이다.
const runToHost = (elf: Uint8Array): number => {
  const machine = createMachine({ clock: { nowMicros: () => 0 }, onUartTransmit: () => {} });
  const tohost = machine.loadElf(elf).symbols.get('tohost');
  if (tohost === undefined) throw new Error('tohost 심볼이 없다');
  for (let executed = 0; executed < MAX_INSTRUCTIONS; executed += CHUNK) {
    machine.run(CHUNK);
    const value = machine.bus.read(tohost, 4);
    if (value !== 0) return value;
  }
  return 0;
};

const names = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.elf'))
  .map((file) => basename(file, '.elf'))
  .sort();
const skips = new Map(readSkips().map((skip) => [skip.name, skip]));
for (const name of skips.keys()) {
  if (!names.includes(name)) throw new Error(`skip.json의 ${name}에 맞는 ELF가 없다`);
}

describe('riscv-tests', () => {
  for (const name of names) {
    const test = skips.has(name) ? it.skip : it;
    test(name, () => {
      const value = runToHost(new Uint8Array(readFileSync(resolve(FIXTURES, `${name}.elf`))));
      const message =
        value === 0 ? 'tohost가 쓰이지 않았다(시간 초과)' : `failed test #${value >> 1}`;
      expect(value, message).toBe(1);
    });
  }
});
