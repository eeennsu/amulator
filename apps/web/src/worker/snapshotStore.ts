export type SnapshotStore = {
  get: (key: string) => Promise<Uint8Array | undefined>;
  put: (key: string, bytes: Uint8Array) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

const DB_NAME = 'amulator';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했다'));
    request.onblocked = () => reject(new Error('다른 탭이 IndexedDB 업그레이드를 막고 있다'));
  });

export const createIndexedDbSnapshotStore = (): SnapshotStore => {
  let database: Promise<IDBDatabase> | undefined;

  // 열기에 실패하면 다음 호출이 다시 열어 보도록 캐시를 비운다.
  const open = (): Promise<IDBDatabase> => {
    database ??= openDatabase().catch((error: unknown) => {
      database = undefined;
      throw error;
    });
    return database;
  };

  // 요청이 아니라 트랜잭션이 끝나야 저장이 디스크에 반영된 것이다.
  const transact = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = work(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      const fail = (): void =>
        reject(transaction.error ?? new Error('IndexedDB 트랜잭션이 실패했다'));
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  };

  return {
    get: async (key) => {
      const value: unknown = await transact('readonly', (store) => store.get(key));
      return value instanceof Uint8Array ? value : undefined;
    },
    put: async (key, bytes) => {
      await transact('readwrite', (store) => store.put(bytes, key));
    },
    delete: async (key) => {
      await transact('readwrite', (store) => store.delete(key));
    },
  };
};
