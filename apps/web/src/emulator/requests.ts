type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void };

// worker로 보낸 요청과 돌아오는 응답을 id로 잇는다.
export const createRequestTable = <T>() => {
  const pending = new Map<number, Pending<T>>();
  let nextId = 1;

  const take = (id: number): Pending<T> | undefined => {
    const entry = pending.get(id);
    pending.delete(id);
    return entry;
  };

  return {
    open: (): { id: number; promise: Promise<T> } => {
      const id = nextId;
      nextId += 1;
      const promise = new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      return { id, promise };
    },
    resolve: (id: number, value: T): void => take(id)?.resolve(value),
    reject: (id: number, error: Error): void => take(id)?.reject(error),
    rejectAll: (error: Error): void => {
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) entry.reject(error);
    },
  };
};
