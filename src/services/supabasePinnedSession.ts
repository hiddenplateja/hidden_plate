// Request-local credentials only: never installs/refreshes another app session.
import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
export type SupabaseSessionIdentity = { userId: string; accessToken: string };
export async function currentSupabaseSessionIdentity(): Promise<SupabaseSessionIdentity | null> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error) throw new Error("Couldn't check your session.");
  return session?.user.id && session.access_token ? { userId: session.user.id, accessToken: session.access_token } : null;
}
export async function assertSupabaseSessionCurrent(identity: SupabaseSessionIdentity): Promise<void> {
  const current = await currentSupabaseSessionIdentity();
  if (current?.userId !== identity.userId || current.accessToken !== identity.accessToken) {
    throw new Error("Your account changed. Please try again.");
  }
}
export async function pinSupabaseSession(expected?: SupabaseSessionIdentity) {
  const identity = expected ?? await currentSupabaseSessionIdentity();
  if (!identity) return null;
  const client = createIsolatedSupabaseAuthClient();
  const { data, error } = await client.auth.getUser(identity.accessToken);
  if (error || data.user?.id !== identity.userId) return null;
  const current = await currentSupabaseSessionIdentity();
  if (current?.userId !== identity.userId || current.accessToken !== identity.accessToken) return null;
  return { ...identity, client };
}
