import { describe, expect, it } from 'vitest';

import { createRequestTable } from '../src/emulator/requests';

describe('createRequestTable', () => {
  it('열린 요청을 id로 풀고 거부한다', async () => {
    const table = createRequestTable<string>();
    const first = table.open();
    const second = table.open();

    table.resolve(first.id, '값');
    table.reject(second.id, new Error('실패'));

    await expect(first.promise).resolves.toBe('값');
    await expect(second.promise).rejects.toThrow('실패');
  });

  it('rejectAll은 남은 요청을 모두 거부하고 표를 비운다', async () => {
    const table = createRequestTable<string>();
    const first = table.open();
    const second = table.open();

    table.rejectAll(new Error('끊겼다'));
    await expect(first.promise).rejects.toThrow('끊겼다');
    await expect(second.promise).rejects.toThrow('끊겼다');

    // 비운 뒤에는 같은 id로 풀어도 아무 일도 없다
    expect(() => table.resolve(first.id, '늦은 값')).not.toThrow();
    expect(() => table.reject(second.id, new Error('늦은 실패'))).not.toThrow();
  });

  it('id는 겹치지 않는다', () => {
    const table = createRequestTable<number>();
    const opened = Array.from({ length: 100 }, () => table.open());
    // 푼 뒤에도 id를 다시 쓰지 않는다
    for (const { id } of opened) table.resolve(id, 0);
    opened.push(table.open());
    const ids = opened.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
