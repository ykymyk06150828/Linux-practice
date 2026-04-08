/**
 * 同一 userId に対する研修コンテナ操作（ensure / reset / release）を直列化する。
 * 並行で createContainer が走ると Docker 409（名前重複）になり得るため。
 */
const pending = new Map<string, Promise<unknown>>();

export function withLearnerContainerLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = pending.get(userId);
  const current = (async () => {
    if (previous) {
      try {
        await previous;
      } catch {
        /* 直前の失敗は無視し、この呼び出しは実行する */
      }
    }
    return fn();
  })();
  pending.set(userId, current);
  return current.finally(() => {
    if (pending.get(userId) === current) {
      pending.delete(userId);
    }
  }) as Promise<T>;
}
