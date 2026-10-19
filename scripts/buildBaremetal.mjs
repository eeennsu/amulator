import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import { findToolchain } from './checkToolchain.mjs';

const BAREMETAL_DIR = join(import.meta.dirname, '..', 'guest', 'baremetal');
const OUT_DIR = join(BAREMETAL_DIR, 'out');

const { values } = parseArgs({ options: { 'llvm-bin': { type: 'string' } } });

try {
  const { clang, lld } = findToolchain({ llvmBin: values['llvm-bin'] });
  const sources = readdirSync(BAREMETAL_DIR)
    .filter((file) => file.endsWith('.c'))
    .sort();
  mkdirSync(OUT_DIR, { recursive: true });

  for (const source of sources) {
    const elf = join(OUT_DIR, `${basename(source, '.c')}.elf`);
    const result = spawnSync(
      clang,
      [
        '--target=riscv32-unknown-elf',
        '-march=rv32im_zicsr',
        '-mabi=ilp32',
        // gp를 초기화하지 않으므로 gp 상대 relax를 끈다.
        '-mno-relax',
        '-ffreestanding',
        '-nostdlib',
        '-O2',
        '-fuse-ld=lld',
        // PATH에 없는 lld도 쓰도록 경로를 명시한다.
        `--ld-path=${lld}`,
        `-Wl,-T,${join(BAREMETAL_DIR, 'link.ld')}`,
        join(BAREMETAL_DIR, 'start.S'),
        join(BAREMETAL_DIR, source),
        '-o',
        elf,
      ],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`${source} 빌드에 실패했다(종료 코드 ${result.status}).`);
    }
    process.stdout.write(`built ${elf}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
