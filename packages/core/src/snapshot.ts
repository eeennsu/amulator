import { z } from 'zod';

import { cpuStateSchema, loadCpuState, saveCpuState } from './cpu/cpuState';
import { clintStateSchema } from './devices/clint';
import { touchStateSchema } from './devices/touch';
import { uartStateSchema } from './devices/uart16550';
import type { Machine } from './machine';
import { EMULATOR_VERSION } from './version';

// 저장 상태의 구성이나 의미가 바뀌면 반드시 올린다.
export const SNAPSHOT_FORMAT_VERSION = 1;

// 포맷: 'AMUS' | u32 LE 포맷 버전 | u32 LE info 길이 | info JSON(ASCII) | 4바이트 정렬 패딩 | 바이너리 영역.
// 바이너리 영역은 ram, framebuffer 순서로 4바이트 정렬해 두고, 버퍼의 offset은 영역 시작 기준이다.
const MAGIC = [0x41, 0x4d, 0x55, 0x53] as const;
const FORMAT_OFFSET = 4;
const INFO_LENGTH_OFFSET = 8;
const HEADER_BYTES = 12;
const WORD_BYTES = 4;
const ASCII_LIMIT = 0x80;
const BUFFER_RAM = 'ram';
const BUFFER_FRAMEBUFFER = 'framebuffer';

const configSchema = z.object({
  ramSize: z.int().positive(),
  devices: z.array(z.string()),
});

const infoSchema = z.object({
  emulatorVersion: z.string(),
  config: configSchema,
  imageHash: z.string(),
  createdAt: z.string(),
  cpu: cpuStateSchema,
  clint: clintStateSchema,
  uart: uartStateSchema,
  touch: touchStateSchema,
  buffers: z.array(z.object({ name: z.string(), offset: z.int().min(0), length: z.int().min(0) })),
});

type SnapshotInfo = z.infer<typeof infoSchema>;

export type MachineConfig = z.infer<typeof configSchema>;

export type SnapshotMeta = {
  formatVersion: number;
  emulatorVersion: string;
  config: MachineConfig;
  imageHash: string;
  createdAt: string;
};

export class SnapshotMismatchError extends Error {
  override name = 'SnapshotMismatchError';

  constructor(readonly reason: 'magic' | 'format' | 'config' | 'image' | 'corrupt') {
    super(`스냅샷을 쓸 수 없다: ${reason}`);
  }
}

const align4 = (value: number): number => Math.ceil(value / WORD_BYTES) * WORD_BYTES;

// 장치 이름을 base 주소 순으로 둔다.
const configOf = (machine: Machine): MachineConfig => ({
  ramSize: machine.ram.length,
  devices: [machine.uart, machine.clint, machine.framebuffer, machine.touch]
    .sort((left, right) => left.base - right.base)
    .map((device) => device.name),
});

const sameConfig = (left: MachineConfig, right: MachineConfig): boolean =>
  left.ramSize === right.ramSize &&
  left.devices.length === right.devices.length &&
  left.devices.every((name, index) => name === right.devices[index]);

// TextEncoder가 없는 환경이라 JSON을 순수 ASCII로 만들어 글자 하나를 바이트 하나로 쓴다.
const NON_ASCII = /[\u007f-￿]/g;
const encodeInfo = (info: SnapshotInfo): Uint8Array => {
  const text = JSON.stringify(info).replace(
    NON_ASCII,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
};

const decodeInfo = (bytes: Uint8Array): string => {
  let text = '';
  for (const byte of bytes) {
    if (byte >= ASCII_LIMIT) throw new SnapshotMismatchError('corrupt');
    text += String.fromCharCode(byte);
  }
  return text;
};

type ParsedSnapshot = { info: SnapshotInfo; binaryStart: number };

// 머신을 건드리지 않는 검사: magic, 포맷 버전, info의 모양.
const parseSnapshot = (bytes: Uint8Array): ParsedSnapshot => {
  if (bytes.length < MAGIC.length || MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new SnapshotMismatchError('magic');
  }
  if (bytes.length < HEADER_BYTES) throw new SnapshotMismatchError('corrupt');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(FORMAT_OFFSET, true) !== SNAPSHOT_FORMAT_VERSION) {
    throw new SnapshotMismatchError('format');
  }
  const infoEnd = HEADER_BYTES + view.getUint32(INFO_LENGTH_OFFSET, true);
  if (infoEnd > bytes.length) throw new SnapshotMismatchError('corrupt');
  const text = decodeInfo(bytes.subarray(HEADER_BYTES, infoEnd));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SnapshotMismatchError('corrupt');
  }
  const parsed = infoSchema.safeParse(json);
  if (!parsed.success) throw new SnapshotMismatchError('corrupt');
  return { info: parsed.data, binaryStart: align4(infoEnd) };
};

export const serializeSnapshot = (machine: Machine, imageHash: string): Uint8Array => {
  const { ram } = machine;
  const { pixels } = machine.framebuffer;
  const framebufferOffset = align4(ram.length);
  const infoBytes = encodeInfo({
    emulatorVersion: EMULATOR_VERSION,
    config: configOf(machine),
    imageHash,
    createdAt: new Date().toISOString(),
    cpu: saveCpuState(machine.cpu),
    clint: machine.clint.saveState(),
    uart: machine.uart.saveState(),
    touch: machine.touch.saveState(),
    buffers: [
      { name: BUFFER_RAM, offset: 0, length: ram.length },
      { name: BUFFER_FRAMEBUFFER, offset: framebufferOffset, length: pixels.length },
    ],
  });
  const binaryStart = align4(HEADER_BYTES + infoBytes.length);
  const out = new Uint8Array(binaryStart + align4(framebufferOffset + pixels.length));
  const view = new DataView(out.buffer);
  out.set(MAGIC);
  view.setUint32(FORMAT_OFFSET, SNAPSHOT_FORMAT_VERSION, true);
  view.setUint32(INFO_LENGTH_OFFSET, infoBytes.length, true);
  out.set(infoBytes, HEADER_BYTES);
  out.set(ram, binaryStart);
  out.set(pixels, binaryStart + framebufferOffset);
  return out;
};

export const readSnapshotMeta = (bytes: Uint8Array): SnapshotMeta => {
  const { info } = parseSnapshot(bytes);
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    emulatorVersion: info.emulatorVersion,
    config: info.config,
    imageHash: info.imageHash,
    createdAt: info.createdAt,
  };
};

// 이름이 name인 버퍼가 파일 안에 온전히 있고 길이가 기대와 같을 때만 그 바이트를 돌려준다.
const bufferBytes = (
  bytes: Uint8Array,
  { info, binaryStart }: ParsedSnapshot,
  name: string,
  expectedLength: number,
): Uint8Array => {
  const entry = info.buffers.find((buffer) => buffer.name === name);
  if (entry === undefined || entry.length !== expectedLength) {
    throw new SnapshotMismatchError('corrupt');
  }
  const start = binaryStart + entry.offset;
  if (start + entry.length > bytes.length) throw new SnapshotMismatchError('corrupt');
  return bytes.subarray(start, start + entry.length);
};

export const restoreSnapshot = (machine: Machine, bytes: Uint8Array, imageHash: string): void => {
  const parsed = parseSnapshot(bytes);
  const { info } = parsed;
  if (!sameConfig(info.config, configOf(machine))) throw new SnapshotMismatchError('config');
  if (info.imageHash !== imageHash) throw new SnapshotMismatchError('image');
  const ram = bufferBytes(bytes, parsed, BUFFER_RAM, machine.ram.length);
  const pixels = bufferBytes(bytes, parsed, BUFFER_FRAMEBUFFER, machine.framebuffer.pixels.length);

  // 여기까지가 검증이다. 실패한 복원이 머신을 반쯤 바꿔 두지 않도록 이 아래에서만 상태를 쓴다.
  loadCpuState(machine.cpu, info.cpu);
  machine.clint.loadState(info.clint);
  machine.uart.loadState(info.uart);
  machine.touch.loadState(info.touch);
  machine.ram.set(ram);
  machine.framebuffer.pixels.set(pixels);
  machine.framebuffer.dirty = true; // 호스트가 복원된 화면을 다시 그리게 한다
};
