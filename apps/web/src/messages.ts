import type { TouchSample } from '@amulator/core/devices/touch';

import type { ProgramName } from './programs';

export type MainToWorker =
  | { type: 'start'; program: ProgramName; canvas: OffscreenCanvas }
  | { type: 'uartInput'; bytes: Uint8Array }
  | { type: 'touch'; event: TouchSample }
  | { type: 'save' }
  | { type: 'reset' };

export type WorkerToMain =
  | { type: 'uartOutput'; bytes: Uint8Array }
  | { type: 'booted'; restored: boolean }
  | { type: 'saved'; bytes: number }
  | { type: 'error'; message: string }
  | { type: 'status'; ips: number };
