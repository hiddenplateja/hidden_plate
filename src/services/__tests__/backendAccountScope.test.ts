import { backendAccountCacheKey, createBackendAccountScope, StaleBackendScopeError, type BackendScopeReset } from "@/services/backendAccountScope";
const a = { namespace: "supabase:project-a", userId: "user-a" };
const b = { ...a, userId: "user-b" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<BackendScopeReset> = {}) {
  const reset = { clearLocalState: jest.fn(), cancelReads: jest.fn().mockResolvedValue(undefined),
    clearMemoryCache: jest.fn(), removePersistedCache: jest.fn().mockResolvedValue(undefined), ...overrides };
  return { reset, scope: createBackendAccountScope(reset) };
}

test("no reads can start before initial cache isolation", async () => {
  const { scope } = setup(); const read = jest.fn();
  await expect(scope.read(read)).rejects.toBeInstanceOf(StaleBackendScopeError);
  expect(read).not.toHaveBeenCalled();
});
test("transition clears visible state and caches before allowing reads", async () => {
  const removal = deferred<void>();
  const { reset, scope } = setup({ removePersistedCache: jest.fn(() => removal.promise) });
  const transition = scope.transition(a);
  expect(reset.clearLocalState).toHaveBeenCalledTimes(1);
  expect(reset.clearMemoryCache).toHaveBeenCalledTimes(1);
  expect(scope.current()).toBeNull();
  await expect(scope.read(async () => "private")).rejects.toBeInstanceOf(StaleBackendScopeError);
  removal.resolve(); expect(await transition).toBe(true);
  expect(scope.current()).toEqual(a);
  expect(await scope.read(async () => "new data")).toBe("new data");
});
test("account switching aborts reads and discards late results even if the request ignores cancellation", async () => {
  const { scope } = setup(); await scope.transition(a);
  const response = deferred<string>(); let signal!: AbortSignal;
  const read = scope.read(current => { signal = current; return response.promise; });
  const result = expect(read).rejects.toBeInstanceOf(StaleBackendScopeError);
  await scope.transition(b); expect(signal.aborted).toBe(true);
  response.resolve("old account's data"); await result;
  expect(scope.current()).toEqual(b);
});
test("A to B to A does not resurrect a read from the first A generation", async () => {
  const { scope } = setup(); await scope.transition(a);
  const response = deferred<string>(); const read = scope.read(() => response.promise);
  const result = expect(read).rejects.toBeInstanceOf(StaleBackendScopeError);
  await scope.transition(b); await scope.transition(a);
  response.resolve("old"); await result;
});
test("guarded publication never commits a stale response", async () => {
  const { scope } = setup(); await scope.transition(a);
  const response = deferred<string>(); const commit = jest.fn();
  const read = scope.readAndCommit(() => response.promise, commit);
  const result = expect(read).rejects.toBeInstanceOf(StaleBackendScopeError);
  await scope.transition(b); response.resolve("private account A data"); await result;
  expect(commit).not.toHaveBeenCalled();
  await scope.readAndCommit(async () => "account B data", commit);
  expect(commit).toHaveBeenCalledWith("account B data");
});
test.each([{ ...a, namespace: "appwrite:project-a" }, { ...a, userId: null }])("backend switches and logout invalidate pending data", async next => {
  const { scope } = setup(); await scope.transition(a);
  const response = deferred<string>(); const read = scope.read(() => response.promise);
  const result = expect(read).rejects.toBeInstanceOf(StaleBackendScopeError);
  await scope.transition(next); response.resolve("old"); await result;
});
test("same ready identity does not clear caches on token refresh", async () => {
  const { reset, scope } = setup(); await scope.transition(a);
  expect(await scope.transition({ ...a })).toBe(true);
  expect(reset.clearLocalState).toHaveBeenCalledTimes(1);
});
test("racing transitions serialize cleanup and only publish the latest identity", async () => {
  const removal = deferred<void>();
  const remove = jest.fn().mockImplementationOnce(() => removal.promise).mockResolvedValue(undefined);
  const { scope } = setup({ removePersistedCache: remove });
  const first = scope.transition(a); const second = scope.transition(b);
  expect(scope.current()).toBeNull(); removal.resolve();
  expect(await first).toBe(false); expect(await second).toBe(true);
  expect(remove.mock.calls.map(call => call[0])).toEqual([null, a]);
  expect(scope.current()).toEqual(b);
});
test.each(["cancelReads", "removePersistedCache"] as const)("failed %s leaves scope closed and retry can recover", async operation => {
  const failed = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const { scope } = setup({ [operation]: failed });
  await expect(scope.transition(a)).rejects.toThrow("offline");
  expect(scope.current()).toBeNull();
  await expect(scope.read(async () => "data")).rejects.toBeInstanceOf(StaleBackendScopeError);
  expect(await scope.transition(a)).toBe(true);
});
test("disposal aborts pending reads and blocks all later reads/transitions", async () => {
  const { scope } = setup(); await scope.transition(a);
  const response = deferred<string>(); const read = scope.read(() => response.promise);
  const result = expect(read).rejects.toBeInstanceOf(StaleBackendScopeError);
  scope.dispose(); response.resolve("old"); await result;
  expect(scope.current()).toBeNull();
  await expect(scope.transition(b)).rejects.toBeInstanceOf(StaleBackendScopeError);
  await expect(scope.read(async () => "data")).rejects.toBeInstanceOf(StaleBackendScopeError);
});
test("cache keys isolate guests, accounts and projects without using session tokens", () => {
  const accounts = [a, b, { ...a, userId: null }, { ...a, userId: "guest" }, { ...a, namespace: "supabase:project-b" }];
  expect(new Set(accounts.map(backendAccountCacheKey)).size).toBe(accounts.length);
});
