import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { findToolchain } from './checkToolchain.mjs';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_DIR = join(ROOT, 'third_party', 'riscv-tests');
const OUT_DIR = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'riscv-tests');

const REPO_URL = 'https://github.com/riscv-software-src/riscv-tests';
const PINNED_COMMIT = 'd7e86f701b929b5d801f8cda1a4871ab05f452bb';
const EXPECTED_COUNTS = { rv32ui: 42, rv32um: 8, rv32mi: 16 };

const git = (args, cwd = ROOT) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 실패: ${result.stderr || result.error?.message}`);
  }
  return result.stdout.trim();
};

// 고정한 커밋과 env 서브모듈을 맞춘다. 이미 맞으면 아무것도 받지 않는다.
const fetchSources = () => {
  if (!existsSync(join(SOURCE_DIR, '.git'))) git(['clone', REPO_URL, SOURCE_DIR]);
  if (git(['rev-parse', 'HEAD'], SOURCE_DIR) !== PINNED_COMMIT) {
    git(['checkout', PINNED_COMMIT], SOURCE_DIR);
  }
  git(['submodule', 'update', '--init', 'env'], SOURCE_DIR);
};

// Makefrag의 `rv32ui_sc_tests = \` 목록을 읽는다. 줄 끝 `\`로 이어진다.
const scTests = (suite) => {
  const list = readFileSync(join(SOURCE_DIR, 'isa', suite, 'Makefrag'), 'utf8')
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${suite}_sc_tests`));
  if (!list) throw new Error(`${suite}/Makefrag에서 ${suite}_sc_tests를 찾지 못했다.`);
  return list
    .slice(list.indexOf('=') + 1)
    .trim()
    .split(/\s+/);
};

const TARGET_FLAGS = [
  '--target=riscv32-unknown-elf',
  '-march=rv32im_zicsr_zifencei',
  '-mabi=ilp32',
];
// 환경 헤더가 `.weak mtvec_handler`를 먼저 선언하고 테스트가 `.global mtvec_handler`를 다시 쓴다.
// GNU as는 weak를 유지하지만 LLVM 23은 "changed binding" 오류를 낸다. 같은 결과가 되도록 `.global` 줄을 뺀다.
const GLOBAL_MTVEC_HANDLER = /^[ \t]*\.global[ \t]+mtvec_handler[ \t]*$/gm;

// 전처리 → .global 줄 제거 → 어셈블·링크. 오류를 내면 throw한다.
const build = ({ clang, lld }, source, elf) => {
  const includes = [
    '-I',
    join(SOURCE_DIR, 'env', 'p'),
    '-I',
    join(SOURCE_DIR, 'isa', 'macros', 'scalar'),
  ];
  const preprocessed = spawnSync(clang, [...TARGET_FLAGS, '-E', ...includes, source], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (preprocessed.status !== 0) throw new Error(`${source} 전처리에 실패했다.`);

  const linked = spawnSync(
    clang,
    [
      ...TARGET_FLAGS,
      // 테스트가 gp를 초기화하지 않으므로 gp 상대 relax를 끈다.
      '-mno-relax',
      '-nostdlib',
      '-nostartfiles',
      '-static',
      '-mcmodel=medany',
      // 어셈블리 입력에서는 medany가 쓰이지 않는다. 브리프의 플래그를 그대로 두되 경고를 끈다.
      '-Qunused-arguments',
      '-fuse-ld=lld',
      // PATH에 없는 lld도 쓰도록 경로를 명시한다.
      `--ld-path=${lld}`,
      '-T',
      join(SOURCE_DIR, 'env', 'p', 'link.ld'),
      '-x',
      'assembler',
      '-',
      '-o',
      elf,
    ],
    {
      input: preprocessed.stdout.replace(GLOBAL_MTVEC_HANDLER, ''),
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
  if (linked.status !== 0)
    throw new Error(`${source} 빌드에 실패했다(종료 코드 ${linked.status}).`);
};

const { values } = parseArgs({ options: { 'llvm-bin': { type: 'string' } } });

try {
  const toolchain = findToolchain({ llvmBin: values['llvm-bin'] });
  fetchSources();
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(join(SOURCE_DIR, 'LICENSE'), join(OUT_DIR, 'LICENSE'));

  for (const [suite, expected] of Object.entries(EXPECTED_COUNTS)) {
    const tests = scTests(suite);
    if (tests.length !== expected) {
      throw new Error(`${suite} 테스트가 ${tests.length}개다. ${expected}개여야 한다.`);
    }
    for (const test of tests) {
      const elf = join(OUT_DIR, `${suite}-p-${test}.elf`);
      build(toolchain, join(SOURCE_DIR, 'isa', suite, `${test}.S`), elf);
      process.stdout.write(`built ${elf}\n`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
