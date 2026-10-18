import { SIGNED_OUT_SNAPSHOT, type AuthSnapshot } from "@/utils/authSession";
/** Pure publication guard: an auth event invalidates earlier async refreshes. */
export function createAuthSnapshotCoordinator(commit: (snapshot: AuthSnapshot) => void) {
  let generation = 0, disposed = false;
  const sanitize = (snapshot: AuthSnapshot): AuthSnapshot => !snapshot.user || snapshot.user.isBanned
    ? { ...SIGNED_OUT_SNAPSHOT } : snapshot;
  return {
    activate() { disposed = false; generation++; },
    publish(snapshot: AuthSnapshot) { if (!disposed) { generation++; commit(sanitize(snapshot)); } },
    async refresh(load: () => Promise<AuthSnapshot>): Promise<boolean> {
      if (disposed) return false;
      const ticket = ++generation;
      const snapshot = await load();
      if (disposed || ticket !== generation) return false;
      commit(sanitize(snapshot));
      return true;
    },
    dispose() { disposed = true; generation++; },
  };
}
