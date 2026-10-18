// Pure, staged provider support. No Auth/client/storage/native imports.
export type BackendAccount = Readonly<{ namespace: string; userId: string | null }>;
export type BackendScopeReset = {
  clearLocalState(): void;
  cancelReads(): Promise<void>;
  clearMemoryCache(): void;
  // Future provider must use per-scope persisters and detach its old persister
  // before reset; removal alone cannot stop a throttled late persistence write.
  removePersistedCache(previous: BackendAccount | null): Promise<void>;
};
export class StaleBackendScopeError extends Error {
  constructor() { super("The account or backend changed. Discard this result."); this.name = "StaleBackendScopeError"; }
}
export function backendAccountCacheKey(account: BackendAccount): string {
  return `${account.namespace}:account:${account.userId === null ? "guest" : `user:${encodeURIComponent(account.userId)}`}`;
}

/** Prevent delayed READ results from reaching a different account's state.
 * Does not pin write credentials; writes must enforce identity at the server.
 */
export function createBackendAccountScope(reset: BackendScopeReset) {
  let generation = 0;
  let account: BackendAccount | null = null;
  let ready = false;
  let disposed = false;
  let controller = new AbortController();
  let cleanup: Promise<void> = Promise.resolve();
  const same = (next: BackendAccount) => account?.namespace === next.namespace && account.userId === next.userId;
  async function runRead<T>(request: (signal: AbortSignal) => Promise<T>, commit?: (result: T) => void): Promise<T> {
    if (disposed || !ready) throw new StaleBackendScopeError();
    const ticket = generation;
    const signal = controller.signal;
    const result = await request(signal);
    if (disposed || !ready || ticket !== generation || signal.aborted) throw new StaleBackendScopeError();
    // State publication must be synchronous here, not in a later unguarded
    // .then()/await callback. No account transition can interleave this check
    // and the synchronous commit on the JavaScript thread.
    commit?.(result);
    return result;
  }
  return {
    async transition(next: BackendAccount): Promise<boolean> {
      if (disposed) throw new StaleBackendScopeError();
      if (ready && same(next)) return true;
      const previous = account;
      const ticket = ++generation;
      controller.abort();
      controller = new AbortController();
      ready = false;
      account = Object.freeze({ ...next });
      reset.clearLocalState();
      // Clear synchronously too, so even a failed cancellation never leaves
      // another account's data available while the transition is pending.
      reset.clearMemoryCache();
      const task = cleanup.catch(() => {}).then(async () => {
        await reset.cancelReads();
        reset.clearMemoryCache();
        await reset.removePersistedCache(previous);
      });
      cleanup = task;
      await task;
      if (disposed || ticket !== generation) return false;
      ready = true;
      return true;
    },
    read: runRead,
    async readAndCommit<T>(request: (signal: AbortSignal) => Promise<T>, commit: (result: T) => void): Promise<void> {
      await runRead(request, commit);
    },
    current(): BackendAccount | null { return ready && !disposed ? account : null; },
    dispose(): void { disposed = true; ready = false; generation++; controller.abort(); },
  };
}
