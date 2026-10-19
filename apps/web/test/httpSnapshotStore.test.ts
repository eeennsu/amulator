import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpSnapshotStore } from '../src/worker/httpSnapshotStore';

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP 스냅샷 저장소', () => {
  it('put은 PUT /snapshots/<key>에 토큰 헤더와 같은 바이트를 보낸다', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    const bytes = Uint8Array.of(1, 2, 3);
    await createHttpSnapshotStore('t').put('k', bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/snapshots/k', {
      method: 'PUT',
      headers: { 'X-Amulator-Token': 't' },
      body: bytes,
    });
  });

  it('put은 2xx가 아니면 reject한다', async () => {
    stubFetch(new Response(null, { status: 500 }));
    await expect(createHttpSnapshotStore('t').put('k', Uint8Array.of(1))).rejects.toThrow('500');
  });

  it('get은 200이면 본문 바이트를 돌려준다', async () => {
    const fetchMock = stubFetch(new Response(Uint8Array.of(9, 8), { status: 200 }));
    expect(await createHttpSnapshotStore('t').get('k')).toEqual(Uint8Array.of(9, 8));
    expect(fetchMock).toHaveBeenCalledWith('/snapshots/k', {
      method: 'GET',
      headers: { 'X-Amulator-Token': 't' },
    });
  });

  it('get은 404이면 undefined, 500이면 reject한다', async () => {
    stubFetch(new Response(null, { status: 404 }));
    expect(await createHttpSnapshotStore('t').get('k')).toBeUndefined();
    stubFetch(new Response(null, { status: 500 }));
    await expect(createHttpSnapshotStore('t').get('k')).rejects.toThrow('500');
  });

  it('delete는 DELETE를 보내고 404도 성공으로 본다', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 404 }));
    await expect(createHttpSnapshotStore('t').delete('k')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/snapshots/k', {
      method: 'DELETE',
      headers: { 'X-Amulator-Token': 't' },
    });
  });

  it('delete는 404 외의 실패면 reject한다', async () => {
    stubFetch(new Response(null, { status: 500 }));
    await expect(createHttpSnapshotStore('t').delete('k')).rejects.toThrow('500');
  });
});
