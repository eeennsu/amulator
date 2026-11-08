import { ABI_REGISTER_NAMES } from '@amulator/core/cpu/disassemble';
import type { CpuView } from '@amulator/core/inspect';

import { changedFields } from './changes';
import { formatHex } from './format';
import type { TryAction } from './types';

type View = { paused: boolean; cpu: Pick<CpuView, 'pc' | 'x' | 'csr'> };

const registerName = (target: number | 'pc'): string =>
  target === 'pc' ? 'pc' : (ABI_REGISTER_NAMES[target] ?? `x${target}`);

// changedFields의 키('x5', 'mepc')를 화면에 보이는 이름('t0', 'mepc')으로 바꾼다.
const fieldName = (key: string): string =>
  key.startsWith('x') ? registerName(Number(key.slice(1))) : key;

// 누르기 전에 에뮬레이터에서 무슨 일이 일어날지 한 줄로 알려 준다.
export const hintText = (action: TryAction): string => {
  switch (action.kind) {
    case 'step':
      return `누르면 에뮬레이터가 명령어 ${action.count === 1 ? '하나' : `${action.count}개`}를 실행한다`;
    case 'runTo':
      return `누르면 에뮬레이터가 ${formatHex(action.address)}에 올 때까지 실행하고 멈춘다`;
    case 'setRegister':
      return `누르면 레지스터 ${registerName(action.target)} 값을 ${action.value}로 바꾼다`;
  }
};

// 방금 누른 동작의 결과다. 레지스터를 고친 동작은 pc가 안 움직이므로 그 레지스터의 새 값만 보인다.
// 그 밖의 동작은 pc의 앞뒤와 바뀐 값 이름을 보이되, 앞 상태가 멈춘 상태가 아니면 비교할 기준이 없어 뒤 pc만 보인다.
export const resultText = (action: TryAction, before: View | undefined, after: View): string => {
  if (action.kind === 'setRegister') {
    const value = action.target === 'pc' ? after.cpu.pc : (after.cpu.x[action.target] ?? 0);
    return `✓ 방금: ${action.label} — ${registerName(action.target)} ${formatHex(value)}`;
  }
  if (before === undefined || !before.paused) {
    return `✓ 방금: ${action.label} — pc ${formatHex(after.cpu.pc)}`;
  }
  const pc = `pc ${formatHex(before.cpu.pc)} → ${formatHex(after.cpu.pc)}`;
  const names = [...changedFields(before.cpu, after.cpu)]
    .filter((key) => key !== 'pc')
    .map(fieldName);
  const changed = names.length === 0 ? '' : ` · 바뀐 값: ${names.join(', ')}`;
  return `✓ 방금: ${action.label} — ${pc}${changed}`;
};
