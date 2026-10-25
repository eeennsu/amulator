import { INSPECTED_CSRS, type CpuView } from '@amulator/core/inspect';

// 키는 'pc', 'x0'~'x31', CSR 이름이다. 이전 상태가 없으면(시작 상태 직후) 아무것도 강조하지 않는다.
export const changedFields = (
  previous: CpuView | undefined,
  next: CpuView,
): ReadonlySet<string> => {
  const changed = new Set<string>();
  if (previous === undefined) return changed;
  if (previous.pc !== next.pc) changed.add('pc');
  next.x.forEach((value, index) => {
    if (previous.x[index] !== value) changed.add(`x${index}`);
  });
  for (const name of INSPECTED_CSRS) {
    if (previous.csr[name] !== next.csr[name]) changed.add(name);
  }
  return changed;
};
