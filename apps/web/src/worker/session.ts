import { createMachine, type Clock, type Machine } from '@amulator/core/machine';
import { restoreSnapshot, serializeSnapshot } from '@amulator/core/snapshot';

import { gunzip, gzip } from './compression';
import type { SnapshotStore } from './snapshotStore';

export type SessionDeps = {
  store: SnapshotStore;
  clock: Clock;
  onUartTransmit: (byte: number) => void;
};

// warning은 저장된 스냅샷이 있었지만 복원하지 못했을 때만 있다(스냅샷이 없으면 없다).
export type BootResult = { restored: boolean; imageHash: string; warning?: string };

export type Session = {
  readonly machine: Machine; // boot와 reset이 새 머신으로 바꾸므로 쓸 때마다 읽는다
  boot: (program: Uint8Array) => Promise<BootResult>; // 같은 해시의 스냅샷이 있으면 복원, 없거나 실패하면 새로 부팅
  save: () => Promise<{ imageHash: string; bytes: number }>;
  restore: () => Promise<boolean>;
  reset: () => Promise<void>; // 스냅샷을 지우고 새로 부팅(지우기 실패는 무시)
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // 복사는 digest가 ArrayBuffer 기반 배열만 받아서다. ELF는 작다.
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createSession = ({ store, clock, onUartTransmit }: SessionDeps): Session => {
  let machine = createMachine({ clock, onUartTransmit });
  let loaded: { program: Uint8Array; imageHash: string } | undefined;

  const requireLoaded = (): { program: Uint8Array; imageHash: string } => {
    if (loaded === undefined) throw new Error('boot하기 전에는 쓸 수 없다');
    return loaded;
  };

  // CPU·CSR·장치 상태를 되돌리는 방법이 새 머신뿐이라 reset도 머신을 새로 만든다.
  const startFresh = (program: Uint8Array): void => {
    machine = createMachine({ clock, onUartTransmit });
    machine.loadElf(program);
  };

  // 저장된 스냅샷이 없는 것은 정상이고, 있는데 못 쓰는 것은 warning으로 알린다.
  const attemptRestore = async (): Promise<{ restored: boolean; warning?: string }> => {
    const { imageHash } = requireLoaded();
    try {
      const stored = await store.get(imageHash);
      if (stored === undefined) return { restored: false };
      restoreSnapshot(machine, await gunzip(stored), imageHash);
      return { restored: true };
    } catch (error: unknown) {
      // 복원 실패는 머신을 건드리지 않으므로 새로 부팅한 상태로 이어 간다.
      const reason = error instanceof Error ? error.message : String(error);
      const warning = `저장된 스냅샷을 복원하지 못해 새로 부팅했다: ${reason}`;
      console.warn(warning, error);
      return { restored: false, warning };
    }
  };

  const restore = async (): Promise<boolean> => (await attemptRestore()).restored;

  const boot = async (program: Uint8Array): Promise<BootResult> => {
    const imageHash = await sha256Hex(program);
    loaded = { program, imageHash };
    startFresh(program);
    return { ...(await attemptRestore()), imageHash };
  };

  const save = async (): Promise<{ imageHash: string; bytes: number }> => {
    const { imageHash } = requireLoaded();
    const bytes = await gzip(serializeSnapshot(machine, imageHash));
    await store.put(imageHash, bytes);
    return { imageHash, bytes: bytes.length };
  };

  const reset = async (): Promise<void> => {
    const { program, imageHash } = requireLoaded();
    try {
      await store.delete(imageHash);
    } catch (error: unknown) {
      // 못 지워도 새로 부팅한다. 남은 스냅샷은 다음 save가 덮어쓰고, 그 전에 새로고침하면 복원된다.
      console.warn('스냅샷을 지우지 못했다', error);
    }
    startFresh(program);
  };

  return {
    get machine() {
      return machine;
    },
    boot,
    save,
    restore,
    reset,
  };
};
