import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const EXE = process.platform === 'win32' ? '.exe' : '';

// PATH 다음에 보는 설치 위치. 윈도우의 C:\tools\llvm은 관리자 권한 없이 아카이브를 푼 경우다.
const INSTALL_DIRS = [
  'C:\\Program Files\\LLVM\\bin',
  'C:\\tools\\llvm\\bin',
  '/opt/homebrew/opt/llvm/bin',
  '/usr/local/opt/llvm/bin',
];
// brew는 ld.lld가 없으면 lld를 따로 깐다.
const LLD_ONLY_DIRS = ['/opt/homebrew/opt/lld/bin', '/usr/local/opt/lld/bin'];

// 실행 실패(파일 없음 포함)와 비정상 종료는 null이다.
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
};

// 환경 변수를 읽지 않으려고 PATH 탐색을 where/which에 맡긴다.
const pathDirs = () => {
  const found =
    process.platform === 'win32' ? run('where', ['clang']) : run('which', ['-a', 'clang']);
  return (found ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => dirname(file));
};

export const findToolchain = ({ llvmBin } = {}) => {
  const dirs = [...(llvmBin ? [llvmBin] : []), ...pathDirs(), ...INSTALL_DIRS];
  const skipped = [];

  for (const dir of dirs) {
    const clang = join(dir, `clang${EXE}`);
    if (!existsSync(clang)) continue;

    // macOS 기본 clang(Apple clang)처럼 riscv32 타깃이 없는 clang은 건너뛴다.
    const targets = run(clang, ['--print-targets']);
    if (!targets || !/^\s*riscv32\b/m.test(targets)) {
      skipped.push(`${clang}: riscv32 타깃이 없다`);
      continue;
    }

    const lld = [dir, ...dirs, ...LLD_ONLY_DIRS]
      .map((lldDir) => join(lldDir, `ld.lld${EXE}`))
      .find((file) => existsSync(file));
    if (!lld) {
      skipped.push(`${clang}: ld.lld를 찾지 못했다`);
      continue;
    }

    const version = (run(clang, ['--version']) ?? '').split(/\r?\n/)[0];
    return { clang, lld, version };
  }

  throw new Error(
    [
      'riscv32를 지원하는 clang과 ld.lld를 찾지 못했다.',
      ...skipped.map((line) => `  - ${line}`),
      '  검사한 디렉터리: ' + dirs.join(', '),
      '  설치: 윈도우 `winget install --id LLVM.LLVM -e`, 맥 `brew install llvm`(ld.lld가 없으면 `brew install lld`).',
      '  다른 위치에 있으면 `--llvm-bin <dir>`로 알려 준다.',
    ].join('\n'),
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { 'llvm-bin': { type: 'string' } } });
  try {
    const { clang, lld, version } = findToolchain({ llvmBin: values['llvm-bin'] });
    process.stdout.write(
      [version, `clang: ${clang}`, `ld.lld: ${lld}`, 'riscv32 target: supported', ''].join('\n'),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
