import { SNAPSHOT_TOKEN_HEADER } from '@amulator/core/control/protocol';

import type { SnapshotStore } from './snapshotStore';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

// 로컬 서버(Task 13)의 /snapshots 엔드포인트를 쓰는 저장소다. 토큰은 서버가 요청마다 확인한다.
export const createHttpSnapshotStore = (token: string): SnapshotStore => {
  const call = (key: string, init: RequestInit): Promise<Response> =>
    fetch(`/snapshots/${encodeURIComponent(key)}`, {
      ...init,
      headers: { [SNAPSHOT_TOKEN_HEADER]: token },
    });

  const failure = (what: string, response: Response): Error =>
    new Error(`${what}: HTTP ${response.status}`);

  return {
    get: async (key) => {
      const response = await call(key, { method: 'GET' });
      if (response.status === HTTP_NOT_FOUND) return undefined;
      if (response.status !== HTTP_OK) throw failure('스냅샷을 받지 못했다', response);
      return new Uint8Array(await response.arrayBuffer());
    },
    put: async (key, bytes) => {
      // fetch 본문은 ArrayBuffer 기반 배열만 받아서 복사한다.
      const response = await call(key, { method: 'PUT', body: Uint8Array.from(bytes) });
      if (!response.ok) throw failure('스냅샷을 저장하지 못했다', response);
    },
    delete: async (key) => {
      const response = await call(key, { method: 'DELETE' });
      if (!response.ok && response.status !== HTTP_NOT_FOUND) {
        throw failure('스냅샷을 지우지 못했다', response);
      }
    },
  };
};
