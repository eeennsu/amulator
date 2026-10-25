import { useEffect, useState } from 'react';

import type { EmulatorController } from '../emulator/mountEmulator';
import type { MachineView } from '../messages';

type Peeked = { state: MachineView; bytes: Uint8Array | undefined };

// pending: 읽는 중이거나 읽을 state가 아직 없다. failed: 닫힘·범위 밖 같은 진짜 실패다.
export type Peek =
  { status: 'pending' } | { status: 'failed' } | { status: 'ready'; bytes: Uint8Array };

const PENDING: Peek = { status: 'pending' };
const FAILED: Peek = { status: 'failed' };

// 멈춘 상태가 올 때마다 그 시점의 메모리를 읽는다. state가 없으면 읽지 않는다.
// 결과는 읽어 온 state의 것일 때만 ready·failed로 돌려줘서, 새 상태가 오는 동안 이전 값이 남아 보이지 않는다.
export const usePeek = (
  controller: EmulatorController | undefined,
  state: MachineView | undefined,
  address: number,
  length: number,
): Peek => {
  const [peeked, setPeeked] = useState<Peeked>();

  useEffect(() => {
    if (controller === undefined || state === undefined) return;
    let cancelled = false;
    // 닫힌 뒤에 오는 결과는 버린다.
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

  if (peeked === undefined || peeked.state !== state) return PENDING;
  return peeked.bytes === undefined ? FAILED : { status: 'ready', bytes: peeked.bytes };
};
