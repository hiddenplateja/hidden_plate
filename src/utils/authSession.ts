import type { User } from "@/types/user";

export interface AuthSnapshot {
  user: User | null;
  isAdmin: boolean;
  needsOnboarding: boolean;
}

export const SIGNED_OUT_SNAPSHOT: AuthSnapshot = {
  user: null, isAdmin: false, needsOnboarding: false,
};

/** Time-box the entire bootstrap, including role/preferences, not just login. */
export async function restoreAuthSnapshot(
  load: () => Promise<AuthSnapshot>,
  timeoutMs = 8000,
): Promise<AuthSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(),
      new Promise<AuthSnapshot>((resolve) => {
        timer = setTimeout(() => resolve({ ...SIGNED_OUT_SNAPSHOT }), timeoutMs);
      }),
    ]);
  } catch {
    return { ...SIGNED_OUT_SNAPSHOT };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
