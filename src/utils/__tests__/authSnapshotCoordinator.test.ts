import { createAuthSnapshotCoordinator } from "@/utils/authSnapshotCoordinator";
import { SIGNED_OUT_SNAPSHOT, type AuthSnapshot } from "@/utils/authSession";
const snapshot = (id: string, banned = false): AuthSnapshot => ({ user: { id, isBanned: banned } as NonNullable<AuthSnapshot["user"]>, isAdmin: true, needsOnboarding: true });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
test("new auth events suppress older delayed refresh state", async () => {
  const commit = jest.fn(), coordinator = createAuthSnapshotCoordinator(commit), old = deferred<AuthSnapshot>();
  const refresh = coordinator.refresh(() => old.promise); coordinator.publish(snapshot("b")); old.resolve(snapshot("a"));
  expect(await refresh).toBe(false); expect(commit.mock.calls).toEqual([[snapshot("b")]]);
});
test("logout cannot be reversed by a slow restoration", async () => {
  const commit = jest.fn(), coordinator = createAuthSnapshotCoordinator(commit), old = deferred<AuthSnapshot>();
  const refresh = coordinator.refresh(() => old.promise); coordinator.publish(SIGNED_OUT_SNAPSHOT); old.resolve(snapshot("a"));
  expect(await refresh).toBe(false); expect(commit).toHaveBeenLastCalledWith(SIGNED_OUT_SNAPSHOT);
});
test("overlapping refreshes only publish the latest", async () => {
  const commit = jest.fn(), coordinator = createAuthSnapshotCoordinator(commit), old = deferred<AuthSnapshot>();
  const first = coordinator.refresh(() => old.promise); expect(await coordinator.refresh(async () => snapshot("b"))).toBe(true);
  old.resolve(snapshot("a")); expect(await first).toBe(false); expect(commit).toHaveBeenCalledTimes(1);
});
test("banned/signed-out snapshots cannot preserve user/admin/onboarding state", async () => {
  const commit = jest.fn(), coordinator = createAuthSnapshotCoordinator(commit);
  coordinator.publish(snapshot("a", true)); expect(commit).toHaveBeenLastCalledWith(SIGNED_OUT_SNAPSHOT);
  await coordinator.refresh(async () => ({ ...SIGNED_OUT_SNAPSHOT, isAdmin: true, needsOnboarding: true }));
  expect(commit).toHaveBeenLastCalledWith(SIGNED_OUT_SNAPSHOT);
});
test("dispose blocks callbacks; React effect reactivation does not revive old requests", async () => {
  const commit = jest.fn(), coordinator = createAuthSnapshotCoordinator(commit), old = deferred<AuthSnapshot>();
  const first = coordinator.refresh(() => old.promise); coordinator.dispose(); coordinator.publish(snapshot("a"));
  expect(await coordinator.refresh(async () => snapshot("a"))).toBe(false); coordinator.activate();
  expect(await coordinator.refresh(async () => snapshot("b"))).toBe(true); old.resolve(snapshot("a"));
  expect(await first).toBe(false); expect(commit.mock.calls).toEqual([[snapshot("b")]]);
});
test("failed refresh does not silently overwrite a verified snapshot", async () => {
  const commit = jest.fn(), coordinator = createAuthSnapshotCoordinator(commit); coordinator.publish(snapshot("a"));
  await expect(coordinator.refresh(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  expect(commit.mock.calls).toEqual([[snapshot("a")]]);
});
