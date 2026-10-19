import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FB_STRIDE } from '@amulator/core/memoryMap';

import { createSession, type Session } from '../src/worker/session';
import type { SnapshotStore } from '../src/worker/snapshotStore';

const GUEST_OUT = resolve(import.meta.dirname, '../../../guest/baremetal/out');
const WHITE = 0x00ff_ffff;
const BLACK = 0x0000_0000;
const READY = 'paint ready\n';
const BOOT_CHUNK = 100_000;
const BOOT_CHUNKS_MAX = 20;
const DRAW_BUDGET = 500_000;
// 스냅샷은 RAM 64 MiB를 담아서 머신 생성·압축이 느린 환경에서는 기본 5초를 넘길 수 있다.
const SLOW_TEST_MS = 30_000;

const readElf = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(GUEST_OUT, name)));

type MemoryStore = SnapshotStore & { entries: Map<string, Uint8Array> };

const createMemoryStore = (): MemoryStore => {
  const entries = new Map<string, Uint8Array>();
  return {
    entries,
    get: (key) => Promise.resolve(entries.get(key)),
    put: (key, bytes) => {
      entries.set(key, bytes);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
};

const newSession = (store: SnapshotStore): { session: Session; output: () => string } => {
  let text = '';
  const session = createSession({
    store,
    clock: { nowMicros: () => 0 },
    onUartTransmit: (byte) => {
      text += String.fromCharCode(byte);
    },
  });
  return { session, output: () => text };
};

// 화면을 다 칠하고 expected를 내기까지 청크 단위로 돌린다.
const runUntilOutput = (session: Session, output: () => string, expected = READY): void => {
  for (let chunk = 0; chunk < BOOT_CHUNKS_MAX && output() !== expected; chunk += 1) {
    session.machine.run(BOOT_CHUNK);
  }
  expect(output()).toBe(expected);
};

const pixel = (session: Session, x: number, y: number): number =>
  session.machine.framebuffer.read(y * FB_STRIDE + x * 4, 4);

const drawLine = (session: Session): void => {
  session.machine.touch.push({ x: 10, y: 10, down: true });
  session.machine.touch.push({ x: 20, y: 10, down: true });
  session.machine.touch.push({ x: 20, y: 10, down: false });
  session.machine.run(DRAW_BUDGET);
};

describe('session', () => {
  it(
    '빈 store에서는 새로 부팅한다',
    async () => {
      const { session } = newSession(createMemoryStore());
      const result = await session.boot(readElf('paint.elf'));
      expect(result.restored).toBe(false);
      expect(result.imageHash).toMatch(/^[0-9a-f]{64}$/);
    },
    SLOW_TEST_MS,
  );

  it(
    '저장한 스냅샷을 새 세션이 복원한다',
    async () => {
      const store = createMemoryStore();
      const paint = readElf('paint.elf');
      const first = newSession(store);
      await first.session.boot(paint);
      runUntilOutput(first.session, first.output);
      drawLine(first.session);
      expect(pixel(first.session, 15, 10)).toBe(BLACK);
      await first.session.save();

      const second = newSession(store);
      const result = await second.session.boot(paint);
      expect(result.restored).toBe(true);
      expect(pixel(second.session, 15, 10)).toBe(BLACK);
      expect(pixel(second.session, 100, 100)).toBe(WHITE);
    },
    SLOW_TEST_MS,
  );

  it(
    'store를 읽지 못해도 새로 부팅한다',
    async () => {
      const store: SnapshotStore = {
        ...createMemoryStore(),
        get: () => Promise.reject(new Error('IndexedDB를 열 수 없다')),
      };
      const { session, output } = newSession(store);
      const result = await session.boot(readElf('paint.elf'));
      expect(result.restored).toBe(false);
      runUntilOutput(session, output);
    },
    SLOW_TEST_MS,
  );

  it(
    '저장이 실패해도 머신은 계속 돈다',
    async () => {
      const store: SnapshotStore = {
        ...createMemoryStore(),
        put: () => Promise.reject(new Error('저장 공간이 부족하다')),
      };
      const { session, output } = newSession(store);
      await session.boot(readElf('paint.elf'));
      await expect(session.save()).rejects.toThrow('저장 공간이 부족하다');
      runUntilOutput(session, output);
    },
    SLOW_TEST_MS,
  );

  it(
    'reset은 스냅샷을 지우고 새로 부팅한다',
    async () => {
      const store = createMemoryStore();
      const { session, output } = newSession(store);
      const { imageHash } = await session.boot(readElf('paint.elf'));
      runUntilOutput(session, output);
      drawLine(session);
      await session.save();
      expect(await store.get(imageHash)).toBeDefined();

      await session.reset();
      expect(await store.get(imageHash)).toBeUndefined();
      expect(pixel(session, 15, 10)).toBe(BLACK);
      expect(pixel(session, 100, 100)).toBe(BLACK); // 새 머신은 아직 화면을 칠하지 않았다
      runUntilOutput(session, output, READY + READY);
      expect(pixel(session, 100, 100)).toBe(WHITE);
      expect(pixel(session, 15, 10)).toBe(WHITE); // 그린 선이 없다
    },
    SLOW_TEST_MS,
  );

  it(
    '스냅샷을 지우지 못해도 reset은 새로 부팅한다',
    async () => {
      const store = createMemoryStore();
      const failing: SnapshotStore = {
        ...store,
        delete: () => Promise.reject(new Error('삭제할 수 없다')),
      };
      const { session, output } = newSession(failing);
      await session.boot(readElf('paint.elf'));
      runUntilOutput(session, output);
      drawLine(session);
      await session.save();

      await session.reset();
      expect(pixel(session, 15, 10)).toBe(BLACK);
      expect(pixel(session, 100, 100)).toBe(BLACK);
    },
    SLOW_TEST_MS,
  );

  it(
    '다른 프로그램의 스냅샷이 같은 키에 있으면 새로 부팅한다',
    async () => {
      const helloStore = createMemoryStore();
      const hello = newSession(helloStore);
      const { imageHash: helloHash } = await hello.session.boot(readElf('hello.elf'));
      await hello.session.save();
      const helloSnapshot = await helloStore.get(helloHash);
      if (helloSnapshot === undefined) throw new Error('hello 스냅샷이 저장되지 않았다');

      const paint = readElf('paint.elf');
      const store = createMemoryStore();
      const { imageHash: paintHash } = await newSession(store).session.boot(paint);
      await store.put(paintHash, helloSnapshot);

      const { session, output } = newSession(store);
      const result = await session.boot(paint);
      expect(result.restored).toBe(false);
      runUntilOutput(session, output);
    },
    SLOW_TEST_MS,
  );
});
