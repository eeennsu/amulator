import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CSR } from '../src/cpu/csr';
import { ABI_REGISTER_NAMES, disassemble } from '../src/cpu/disassemble';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/disasm.txt');
const MAX_SKIPPED = 50;
const HEX = 16;
const ABI_REGISTER_COUNT = 32;
const S0_INDEX = 8;
const UNKNOWN_WORD = 0xffff_ffff;
const RAM_BASE = 0x8000_0000;

type Expected = { pc: number; word: number; text: string };

const readExpected = (): Expected[] =>
  readFileSync(FIXTURE, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [pc = '', word = '', ...text] = line.split(' ');
      return {
        pc: Number.parseInt(pc, HEX),
        word: Number.parseInt(word, HEX),
        text: text.join(' '),
      };
    });

// LLVM이 에뮬레이터에 없는 CSR(mnstatus 등)에 붙인 이름은 우리 쪽이 0x 숫자로 적어 달라진다.
const hasUnknownCsrName = (text: string): boolean => {
  const [mnemonic = '', ...rest] = text.split(' ');
  if (!mnemonic.startsWith('csr')) return false;
  const name = rest.join(' ').split(', ')[1] ?? '';
  return !(name in CSR) && !name.startsWith('0x');
};

describe('disassemble', () => {
  it('기대값 파일의 모든 명령어를 objdump와 같게 푼다', () => {
    let skipped = 0;
    for (const { pc, word, text } of readExpected()) {
      if (hasUnknownCsrName(text)) {
        skipped += 1;
        continue;
      }
      expect(disassemble(word, pc), word.toString(HEX).padStart(8, '0')).toBe(text);
    }
    expect(skipped).toBeLessThan(MAX_SKIPPED);
  });

  it('ABI 이름은 32개이고 x8은 s0이다', () => {
    expect(ABI_REGISTER_NAMES.length).toBe(ABI_REGISTER_COUNT);
    expect(ABI_REGISTER_NAMES[S0_INDEX]).toBe('s0');
  });

  it('알 수 없는 워드는 <unknown>이다', () => {
    expect(disassemble(UNKNOWN_WORD, RAM_BASE)).toBe('<unknown>');
  });

  it('분기 대상은 pc 기준 절대 주소다', () => {
    expect(disassemble(0x00b57863, 0x8000_0024)).toBe('bgeu a0, a1, 0x80000034');
  });
});
