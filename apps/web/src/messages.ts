import type { AccessWidth, DeviceAccess } from '@amulator/core/bus';
import type { BridgeRequest, BridgeResponse, Point } from '@amulator/core/control/protocol';
import type { TouchSample, TouchState } from '@amulator/core/devices/touch';
import type { CpuView, ElfSummary, MemoryRegion } from '@amulator/core/inspect';
import type { SnapshotMeta, SnapshotSection } from '@amulator/core/snapshot';

import type { ProgramName } from './programs';

export type Gesture =
  { kind: 'tap'; at: Point } | { kind: 'drag'; from: Point; to: Point; steps: number };

export type RegisterTarget = number | 'pc';

export type MachineView = { paused: boolean; cpu: CpuView; touch: TouchState };

// reset 뒤에는 booted를 기다린 다음 inspect한다. 그 전의 state는 이전 머신의 것이다.
// breakAt은 주소 하나다. 실행 루프에서 pc가 그 주소에 오면(그 명령 실행 전) 멈추고 state를 보낸 뒤 꺼진다.
// 새 breakAt, null, reset, start도 끈다. step은 이 주소를 보지 않는다. 이미 그 주소에 있는데 resume하면 바로 멈춘다.
// persist가 false면 IndexedDB·HTTP 저장소를 읽지도 쓰지도 지우지도 않고 메모리 저장소를 쓴다.
export type MainToWorker =
  | {
      type: 'start';
      program: ProgramName;
      canvas: OffscreenCanvas;
      token?: string;
      persist: boolean;
    }
  | { type: 'breakAt'; address: number | null }
  | { type: 'uartInput'; bytes: Uint8Array }
  | { type: 'touch'; event: TouchSample }
  | { type: 'save' }
  | { type: 'reset' }
  | { type: 'bridge'; request: BridgeRequest }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step'; count: number }
  | { type: 'inspect' }
  | { type: 'peek'; id: number; address: number; length: number }
  | { type: 'setRegister'; target: RegisterTarget; value: number }
  | { type: 'busWrite'; address: number; width: AccessWidth; value: number }
  | { type: 'trace'; enabled: boolean }
  | { type: 'gesture'; gesture: Gesture }
  | { type: 'describeSnapshot'; id: number };

export type WorkerToMain =
  | { type: 'uartOutput'; bytes: Uint8Array }
  | {
      type: 'booted';
      restored: boolean;
      warning?: string;
      elf: ElfSummary;
      regions: MemoryRegion[];
    }
  | { type: 'saved'; bytes: number }
  | { type: 'error'; message: string; id?: number }
  | { type: 'status'; ips: number }
  | { type: 'bridgeResponse'; response: BridgeResponse }
  | { type: 'bridgeScreenshot'; id: number; png: ArrayBuffer }
  | { type: 'state'; state: MachineView }
  | { type: 'memory'; id: number; address: number; bytes: Uint8Array }
  | { type: 'deviceAccesses'; accesses: DeviceAccess[]; dropped: number }
  | {
      type: 'snapshotInfo';
      id: number;
      meta: SnapshotMeta;
      sections: SnapshotSection[];
      gzipBytes: number;
    };
