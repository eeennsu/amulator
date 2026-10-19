import type { BridgeRequest, BridgeResponse } from '@amulator/core/control/protocol';
import type { TouchSample } from '@amulator/core/devices/touch';

import type { ProgramName } from './programs';

export type MainToWorker =
  | { type: 'start'; program: ProgramName; canvas: OffscreenCanvas; token?: string }
  | { type: 'uartInput'; bytes: Uint8Array }
  | { type: 'touch'; event: TouchSample }
  | { type: 'save' }
  | { type: 'reset' }
  | { type: 'bridge'; request: BridgeRequest };

export type WorkerToMain =
  | { type: 'uartOutput'; bytes: Uint8Array }
  | { type: 'booted'; restored: boolean; warning?: string }
  | { type: 'saved'; bytes: number }
  | { type: 'error'; message: string }
  | { type: 'status'; ips: number }
  | { type: 'bridgeResponse'; response: BridgeResponse }
  | { type: 'bridgeScreenshot'; id: number; png: ArrayBuffer };
