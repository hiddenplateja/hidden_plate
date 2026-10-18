// Explicit request-local credentials; never swaps the shared SDK client/session.
import { assertSupabaseSessionCurrent, pinSupabaseSession } from "@/services/supabasePinnedSession";
import { assertSupabaseSessionRevision, captureSupabaseSessionRevision } from "@/services/supabaseSessionFence";
export type SupabaseDataSession = NonNullable<Awaited<ReturnType<typeof pinSupabaseSession>>> & { revision: number };
export async function requireSupabaseDataSession(): Promise<SupabaseDataSession> {
  const revision = captureSupabaseSessionRevision();
  const pinned = await pinSupabaseSession();
  assertSupabaseSessionRevision(revision);
  if (!pinned) throw new Error("You must be signed in. Your account may have changed.");
  return { ...pinned, revision };
}
export async function assertSupabaseDataSession(pinned: SupabaseDataSession): Promise<void> {
  assertSupabaseSessionRevision(pinned.revision);
  await assertSupabaseSessionCurrent(pinned);
  assertSupabaseSessionRevision(pinned.revision);
}
export async function rpcForSupabaseDataSession(pinned: SupabaseDataSession, name: string, args?: Record<string, unknown>) {
  await assertSupabaseDataSession(pinned);
  const query = args === undefined ? pinned.client.rpc(name) : pinned.client.rpc(name, args);
  const result = await query.setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseDataSession(pinned);
  return result;
}
export async function requestSupabaseRpc(name: string, args?: Record<string, unknown>) {
  return rpcForSupabaseDataSession(await requireSupabaseDataSession(), name, args);
}
export async function restForSupabaseDataSession<T>(pinned: SupabaseDataSession,
  build: (client: SupabaseDataSession["client"]) => { setHeader(name: string, value: string): PromiseLike<T> }): Promise<T> {
  await assertSupabaseDataSession(pinned);
  const result = await build(pinned.client).setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseDataSession(pinned);
  return result;
}
