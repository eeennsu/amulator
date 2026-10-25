import { ABI_REGISTER_NAMES } from '@amulator/core/cpu/disassemble';
import type { CpuView } from '@amulator/core/inspect';

import { formatHex } from './format';
import type { TryAction } from './types';

type View = { paused: boolean; cpu: Pick<CpuView, 'pc' | 'x'> };

const registerName = (target: number | 'pc'): string =>
  target === 'pc' ? 'pc' : (ABI_REGISTER_NAMES[target] ?? `x${target}`);

// 누르기 전에 왼쪽에서 무슨 일이 일어날지 한 줄로 알려 준다.
export const hintText = (action: TryAction): string => {
  switch (action.kind) {
    case 'step':
      return `누르면 왼쪽 에뮬레이터가 명령어 ${action.count === 1 ? '하나' : `${action.count}개`}를 실행한다`;
    case 'runTo':
      return `누르면 왼쪽 에뮬레이터가 ${formatHex(action.address)}에 올 때까지 실행하고 멈춘다`;
    case 'setRegister':
      return `누르면 왼쪽 레지스터 ${registerName(action.target)} 값을 ${action.value}로 바꾼다`;
  }
};

// 방금 누른 동작의 결과다. 앞 상태가 멈춘 상태가 아니면 그 pc는 믿을 수 없어 뒤 pc만 보인다.
export const resultText = (action: TryAction, before: View | undefined, after: View): string => {
  const pc =
    before !== undefined && before.paused
      ? `pc ${formatHex(before.cpu.pc)} → ${formatHex(after.cpu.pc)}`
      : `pc ${formatHex(after.cpu.pc)}`;
  const written =
    action.kind === 'setRegister'
      ? `, ${registerName(action.target)} ${formatHex(
          action.target === 'pc' ? after.cpu.pc : (after.cpu.x[action.target] ?? 0),
        )}`
      : '';
  return `✓ 방금: ${action.label} — ${pc}${written}`;
};
