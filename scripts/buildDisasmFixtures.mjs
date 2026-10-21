import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { findToolchain } from './checkToolchain.mjs';

const ROOT = join(import.meta.dirname, '..');
const ELF_DIRS = [
  join(ROOT, 'guest', 'baremetal', 'out'),
  join(ROOT, 'packages', 'core', 'test', 'fixtures', 'riscv-tests'),
];
const OUTPUT = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'disasm.txt');
const EXE = process.platform === 'win32' ? '.exe' : '';
const MAX_BUFFER = 256 * 1024 * 1024;

// `80000024: 00b57863 \tbgeu\ta0, a1, 0x80000034 <_start+0x34>`
const INSTRUCTION_LINE = /^\s*([0-9a-f]+):\s+([0-9a-f]{8})\s+(\S.*)$/;
const SYMBOL_SUFFIX = /\s*<[^>]*>\s*$/;

const { values } = parseArgs({ options: { 'llvm-bin': { type: 'string' } } });

try {
  const { clang } = findToolchain({ llvmBin: values['llvm-bin'] });
  const objdump = join(dirname(clang), `llvm-objdump${EXE}`);

  const version = spawnSync(objdump, ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) throw new Error(`${objdump}를 실행하지 못했다`);
  const versionLine = version.stdout.split(/\r?\n/).find((line) => line.includes('LLVM version'));

  const elfs = ELF_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith('.elf'))
      .sort()
      .map((file) => join(dir, file)),
  );

  // word가 같은 줄은 처음 나온 하나만 남긴다.
  const lines = new Map();
  for (const elf of elfs) {
    const result = spawnSync(objdump, ['-d', '-M', 'no-aliases', elf], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    if (result.status !== 0) throw new Error(`${elf}: ${result.stderr}`);

    for (const line of result.stdout.split(/\r?\n/)) {
      const match = INSTRUCTION_LINE.exec(line);
      if (!match) continue; // 2바이트(C 확장) 줄은 word가 4자리라 여기서 빠진다
      const [, pc, word, rest] = match;
      if (lines.has(word)) continue;
      const text = rest.replace(SYMBOL_SUFFIX, '').split(/\s+/).join(' ');
      lines.set(word, `${pc.padStart(8, '0')} ${word} ${text}`);
    }
  }

  writeFileSync(OUTPUT, [`# ${versionLine.trim()}`, ...lines.values(), ''].join('\n'));
  process.stdout.write(`${lines.size}줄을 ${OUTPUT}에 썼다\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
