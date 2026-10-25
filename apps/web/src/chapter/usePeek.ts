import { useEffect, useState } from 'react';

import type { EmulatorController } from '../emulator/mountEmulator';
import type { MachineView } from '../messages';

type Peeked = { state: MachineView; bytes: Uint8Array | undefined };

// 멈춘 상태가 올 때마다 그 시점의 메모리를 읽는다. state가 없으면 읽지 않는다.
// 결과는 읽어 온 state의 것일 때만 돌려줘서, 새 상태가 오는 동안 이전 값이 남아 보이지 않는다.
export const usePeek = (
  controller: EmulatorController | undefined,
  state: MachineView | undefined,
  address: number,
  length: number,
): Uint8Array | undefined => {
  const [peeked, setPeeked] = useState<Peeked>();

  useEffect(() => {
    if (controller === undefined || state === undefined) return;
    let cancelled = false;
    // 닫힘·범위 밖 거부는 읽을 수 없는 칸으로 보인다. 닫힌 뒤에 오는 결과는 버린다.
    void controller.peek(address, length).then(
      (bytes) => {
        if (!cancelled) setPeeked({ state, bytes });
      },
      () => {
        if (!cancelled) setPeeked({ state, bytes: undefined });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [controller, state, address, length]);

  return peeked !== undefined && peeked.state === state ? peeked.bytes : undefined;
};
