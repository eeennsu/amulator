import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PRIVILEGE } from '../src/cpu/cpu';
import { saveCpuState } from '../src/cpu/cpuState';
import { CSR, MIP_MEIP, MIP_MSIP, MSTATUS_MIE, MSTATUS_MPIE, MSTATUS_MPP } from '../src/cpu/csr';
import { createMachine, type Machine } from '../src/machine';
import { CLINT_BASE, FB_STRIDE, UART_BASE } from '../src/memoryMap';
import {
  readSnapshotMeta,
  restoreSnapshot,
  serializeSnapshot,
  SNAPSHOT_FORMAT_VERSION,
  SnapshotMismatchError,
} from '../src/snapshot';
import { EMULATOR_VERSION } from '../src/version';

const GUEST_OUT = resolve(import.meta.dirname, '../../../guest/baremetal/out');
const MIB = 1024 * 1024;
const HEADER_BYTES = 12;
const FORMAT_OFFSET = 4;
const WHITE = 0x00ff_ffff;
const BLACK = 0x0000_0000;
const READY = 'paint ready\n';
const BOOT_CHUNK = 100_000;
const BOOT_CHUNKS_MAX = 20;
const DRAW_BUDGET = 500_000;
const RUN_BUDGET = 200_000;
const SAVED_MTIME = 5_000_000;
const STATE_CSRS = [
  CSR.mstatus,
  CSR.mtvec,
  CSR.mepc,
  CSR.mcause,
  CSR.mtval,
  CSR.mie,
  CSR.mip,
  CSR.mscratch,
  CSR.mcounteren,
  CSR.mcycle,
  CSR.mcycleh,
  CSR.minstret,
  CSR.minstreth,
];

type Guest = { machine: Machine; state: { now: number; output: string } };

const createGuest = (elfName: string | undefined, ramSize?: number): Guest => {
  const state = { now: 0, output: '' };
  const machine = createMachine({
    clock: { nowMicros: () => state.now },
    onUartTransmit: (byte) => {
      state.output += String.fromCharCode(byte);
    },
    ...(ramSize === undefined ? {} : { ramSize }),
  });
  if (elfName !== undefined) {
    machine.loadElf(new Uint8Array(readFileSync(resolve(GUEST_OUT, elfName))));
  }
  return { machine, state };
};

// 화면을 다 칠하고 READY를 내기까지 청크 단위로 돌린다.
const bootPaint = (): Guest => {
  const guest = createGuest('paint.elf');
  for (let chunk = 0; chunk < BOOT_CHUNKS_MAX && guest.state.output !== READY; chunk += 1) {
    guest.machine.run(BOOT_CHUNK);
  }
  expect(guest.state.output).toBe(READY);
  return guest;
};

const pushStroke = (machine: Machine, fromX: number, toX: number, y: number): void => {
  machine.touch.push({ x: fromX, y, down: true });
  machine.touch.push({ x: toX, y, down: true });
  machine.touch.push({ x: toX, y, down: false });
};

const pixelAt = (machine: Machine, x: number, y: number): number =>
  machine.framebuffer.read(y * FB_STRIDE + x * 4, 4);

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right);

const expectSameMachine = (actual: Machine, expected: Machine): void => {
  expect(actual.cpu.pc).toBe(expected.cpu.pc);
  expect(actual.cpu.privilege).toBe(expected.cpu.privilege);
  expect(actual.cpu.idle).toBe(expected.cpu.idle);
  expect(Array.from(actual.cpu.x)).toEqual(Array.from(expected.cpu.x));
  for (const address of STATE_CSRS) {
    expect(actual.cpu.readCsr(address)).toBe(expected.cpu.readCsr(address));
  }
  expect(sameBytes(actual.framebuffer.pixels, expected.framebuffer.pixels)).toBe(true);
  expect(sameBytes(actual.ram, expected.ram)).toBe(true);
};

const reasonOf = (action: () => void): string | undefined => {
  try {
    action();
  } catch (error) {
    if (error instanceof SnapshotMismatchError) return error.reason;
    throw error;
  }
  return undefined;
};

// 복원이 거부되면 이유를 돌려주고, 그때 대상 머신이 그대로인지도 확인한다.
const rejection = (target: Machine, bytes: Uint8Array, imageHash: string): string | undefined => {
  const before = {
    pc: target.cpu.pc,
    x: Array.from(target.cpu.x),
    ram: target.ram.slice(),
    pixels: target.framebuffer.pixels.slice(),
    dirty: target.framebuffer.dirty,
  };
  const reason = reasonOf(() => {
    restoreSnapshot(target, bytes, imageHash);
  });
  expect(reason).toBeDefined();
  expect(target.cpu.pc).toBe(before.pc);
  expect(Array.from(target.cpu.x)).toEqual(before.x);
  expect(sameBytes(target.ram, before.ram)).toBe(true);
  expect(sameBytes(target.framebuffer.pixels, before.pixels)).toBe(true);
  expect(target.framebuffer.dirty).toBe(before.dirty);
  return reason;
};

const align4 = (value: number): number => Math.ceil(value / 4) * 4;

// info JSON 텍스트만 고쳐 다시 조립한다. 바이너리 영역은 그대로 둔다.
const rewriteInfo = (bytes: Uint8Array, edit: (info: string) => string): Uint8Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const infoLength = view.getUint32(8, true);
  const info = new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + infoLength));
  const edited = edit(info);
  expect(edited).not.toBe(info);
  const infoBytes = new TextEncoder().encode(edited);
  const binary = bytes.subarray(align4(HEADER_BYTES + infoLength));
  const start = align4(HEADER_BYTES + infoBytes.length);
  const out = new Uint8Array(start + binary.length);
  out.set(bytes.subarray(0, HEADER_BYTES));
  new DataView(out.buffer).setUint32(8, infoBytes.length, true);
  out.set(infoBytes, HEADER_BYTES);
  out.set(binary, start);
  return out;
};

describe('스냅샷 왕복', () => {
  it('그림을 그린 머신을 새 머신에 복원하면 상태가 같다', () => {
    const a = bootPaint();
    pushStroke(a.machine, 10, 120, 60);
    a.machine.run(DRAW_BUDGET);
    expect(pixelAt(a.machine, 60, 60)).toBe(BLACK);

    const bytes = serializeSnapshot(a.machine, 'h1');
    const b = createGuest('paint.elf');
    expect(b.machine.framebuffer.dirty).toBe(false);
    restoreSnapshot(b.machine, bytes, 'h1');

    expectSameMachine(b.machine, a.machine);
    expect(pixelAt(b.machine, 60, 60)).toBe(BLACK);
    expect(pixelAt(b.machine, 60, 70)).toBe(WHITE);
    expect(b.machine.framebuffer.dirty).toBe(true);
  });

  it('같은 터치 이벤트를 넣으면 원본과 복원본이 같은 길을 간다', () => {
    const a = bootPaint();
    const b = createGuest('paint.elf');
    restoreSnapshot(b.machine, serializeSnapshot(a.machine, 'h1'), 'h1');

    for (const { machine } of [a, b]) {
      pushStroke(machine, 30, 200, 100);
      machine.run(RUN_BUDGET);
    }

    expect(pixelAt(a.machine, 100, 100)).toBe(BLACK);
    expectSameMachine(b.machine, a.machine);
  });

  it('wfi에서 쉬는 중 받은 입력도 복원본에서 깨운다', () => {
    const a = createGuest('clock.elf');
    expect(a.machine.run(BOOT_CHUNK).idle).toBe(true);
    a.machine.uart.receive(new TextEncoder().encode('x'));
    const bytes = serializeSnapshot(a.machine, 'h1');

    const b = createGuest('clock.elf');
    restoreSnapshot(b.machine, bytes, 'h1');
    const result = b.machine.run(BOOT_CHUNK);

    expect(b.state.output).toBe('x');
    expect(result.idle).toBe(true);
  });

  it('CSR와 장치 레지스터를 하나도 빠뜨리지 않는다', () => {
    const a = createGuest(undefined, MIB);
    const { cpu, bus } = a.machine;
    for (let index = 1; index < cpu.x.length; index += 1) cpu.x[index] = index * 0x0101_0101;
    cpu.pc = 0x8000_1230;
    cpu.privilege = PRIVILEGE.user;
    cpu.idle = true;
    const csrValues: [number, number][] = [
      [CSR.mstatus, MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP],
      [CSR.mtvec, 0x8000_0100],
      [CSR.mepc, 0x8000_0200],
      [CSR.mcause, 0x8000_0007],
      [CSR.mtval, 0x1234_5678],
      [CSR.mie, MIP_MSIP | MIP_MEIP],
      [CSR.mscratch, 0xcafe_f00d],
      [CSR.mcounteren, 0b111],
      [CSR.mcycle, 0xffff_fff0],
      [CSR.mcycleh, 0x9abc_def0],
      [CSR.minstret, 11],
      [CSR.minstreth, 22],
    ];
    for (const [address, value] of csrValues) cpu.writeCsr(address, value);
    cpu.setInterruptPending(MIP_MSIP, true);
    cpu.setInterruptPending(MIP_MEIP, true);
    // DLAB를 켜 DLL·DLM을 쓰고 끈 뒤 나머지 레지스터를 쓴다
    bus.write(UART_BASE + 3, 1, 0x83);
    bus.write(UART_BASE + 0, 1, 0x12);
    bus.write(UART_BASE + 1, 1, 0x34);
    bus.write(UART_BASE + 3, 1, 0x03);
    bus.write(UART_BASE + 1, 1, 0x05);
    bus.write(UART_BASE + 4, 1, 0x06);
    bus.write(UART_BASE + 7, 1, 0x77);
    a.machine.uart.receive(Uint8Array.of(1, 2, 3));
    bus.write(CLINT_BASE + 0x0, 4, 1);
    bus.write(CLINT_BASE + 0x4000, 4, 0x1234);
    bus.write(CLINT_BASE + 0x4004, 4, 0x56);
    a.machine.touch.push({ x: 5, y: 6, down: true });
    a.machine.touch.push({ x: 7, y: 8, down: false });
    a.machine.ram[0x1000] = 0xab;
    a.machine.framebuffer.pixels[0x20] = 0xcd;

    const b = createGuest(undefined, MIB);
    restoreSnapshot(b.machine, serializeSnapshot(a.machine, 'h1'), 'h1');

    for (const [address] of csrValues) {
      expect(a.machine.cpu.readCsr(address)).not.toBe(0);
    }
    expect(a.machine.cpu.readCsr(CSR.mip)).toBe(MIP_MSIP | MIP_MEIP);
    expectSameMachine(b.machine, a.machine);
    expect(saveCpuState(b.machine.cpu)).toEqual(saveCpuState(a.machine.cpu));
    expect(b.machine.uart.saveState()).toEqual(a.machine.uart.saveState());
    expect(b.machine.clint.saveState().msip).toBe(1);
    expect(b.machine.clint.mtimecmp()).toBe(0x56 * 0x1_0000_0000 + 0x1234);
    expect(b.machine.touch.saveState()).toEqual(a.machine.touch.saveState());
    expect(b.machine.touch.queueLength).toBe(2);
    expect(b.machine.ram[0x1000]).toBe(0xab);
    expect(b.machine.framebuffer.pixels[0x20]).toBe(0xcd);
  });
});

describe('스냅샷 거부', () => {
  const source = (): Uint8Array => serializeSnapshot(createGuest(undefined, MIB).machine, 'h1');
  const target = (): Machine => createGuest(undefined, MIB).machine;

  it('이미지 해시가 다르면 image다', () => {
    expect(rejection(target(), source(), 'h2')).toBe('image');
  });

  it('첫 바이트가 다르면 magic이다', () => {
    const bytes = source().slice();
    bytes[0] = 0x58;
    expect(rejection(target(), bytes, 'h1')).toBe('magic');
  });

  it('포맷 버전이 다르면 format이다', () => {
    const bytes = source().slice();
    new DataView(bytes.buffer).setUint32(FORMAT_OFFSET, SNAPSHOT_FORMAT_VERSION + 1, true);
    expect(rejection(target(), bytes, 'h1')).toBe('format');
  });

  it('램 크기가 다른 머신이면 config다', () => {
    const other = createMachine({
      clock: { nowMicros: () => 0 },
      onUartTransmit: () => undefined,
      ramSize: 32 * MIB,
    });
    expect(rejection(other, source(), 'h1')).toBe('config');
  });

  it('장치 구성이 다르면 config다', () => {
    const bytes = rewriteInfo(source(), (info) => info.replace('"touch"]', '"gpu"]'));
    expect(rejection(target(), bytes, 'h1')).toBe('config');
  });

  it.each([
    ['info JSON이 깨졌다', (bytes: Uint8Array) => bytes.with(HEADER_BYTES, 0x7e)],
    ['info가 파일보다 길다', (bytes: Uint8Array) => bytes.slice(0, HEADER_BYTES)],
    [
      'info에 ASCII가 아닌 바이트가 있다',
      (bytes: Uint8Array) => bytes.with(HEADER_BYTES + 2, 0xc3),
    ],
    [
      '스키마에 맞지 않는다',
      (bytes: Uint8Array) => rewriteInfo(bytes, (i) => i.replace('"imageHash"', '"imageHush"')),
    ],
    [
      'x0이 0이 아니다',
      (bytes: Uint8Array) => rewriteInfo(bytes, (i) => i.replace('"x":[0,', '"x":[1,')),
    ],
    [
      '램 버퍼 길이가 config와 다르다',
      (bytes: Uint8Array) =>
        rewriteInfo(bytes, (i) => i.replace(`"length":${MIB}`, `"length":${MIB + 4}`)),
    ],
    ['바이너리 영역이 잘렸다', (bytes: Uint8Array) => bytes.subarray(0, bytes.length - 8)],
  ])('%s면 corrupt다', (_name, tamper) => {
    expect(rejection(target(), tamper(source()), 'h1')).toBe('corrupt');
  });
});

describe('스냅샷 메타', () => {
  it('포맷·구성·이미지 해시·생성 시각을 읽는다', () => {
    const bytes = serializeSnapshot(createGuest(undefined, MIB).machine, 'h1');
    const meta = readSnapshotMeta(bytes);
    expect(meta.formatVersion).toBe(SNAPSHOT_FORMAT_VERSION);
    expect(meta.emulatorVersion).toBe(EMULATOR_VERSION);
    expect(meta.config).toEqual({
      ramSize: MIB,
      devices: ['uart16550', 'clint', 'framebuffer', 'touch'],
    });
    expect(meta.imageHash).toBe('h1');
    expect(new Date(meta.createdAt).toISOString()).toBe(meta.createdAt);
  });

  it('이미지 해시의 ASCII가 아닌 글자도 왕복한다', () => {
    const hash = '해시\u{1f600}\u007f';
    const a = createGuest(undefined, MIB).machine;
    const bytes = serializeSnapshot(a, hash);
    expect(bytes.subarray(HEADER_BYTES, HEADER_BYTES + 64).every((byte) => byte < 0x80)).toBe(true);
    expect(readSnapshotMeta(bytes).imageHash).toBe(hash);
    restoreSnapshot(createGuest(undefined, MIB).machine, bytes, hash);
  });

  it('에뮬레이터 버전이 달라도 기록만 하고 복원한다', () => {
    const bytes = rewriteInfo(
      serializeSnapshot(createGuest(undefined, MIB).machine, 'h1'),
      (info) =>
        info.replace(`"emulatorVersion":"${EMULATOR_VERSION}"`, '"emulatorVersion":"9.9.9"'),
    );
    expect(readSnapshotMeta(bytes).emulatorVersion).toBe('9.9.9');
    restoreSnapshot(createGuest(undefined, MIB).machine, bytes, 'h1');
  });
});

describe('시간 연속성', () => {
  it('저장한 mtime에서 새 시계로 이어 간다', () => {
    const a = createGuest(undefined, MIB);
    a.state.now = SAVED_MTIME;
    expect(a.machine.clint.mtime()).toBe(SAVED_MTIME);
    const bytes = serializeSnapshot(a.machine, 'h1');

    const b = createGuest(undefined, MIB);
    b.state.now = 100;
    restoreSnapshot(b.machine, bytes, 'h1');
    expect(b.machine.clint.mtime()).toBe(SAVED_MTIME);
    b.state.now = 110;
    expect(b.machine.clint.mtime()).toBe(SAVED_MTIME + 10);
  });
});
