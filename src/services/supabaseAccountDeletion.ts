// Staged only: settings still invokes the existing Appwrite implementation.
import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";

export type SupabaseDeletionSummary = {
  reviewsAnonymized: number; commentsAnonymized: number; likesDeleted: number;
  savedDeleted: number; followsDeleted: number; notificationsDeleted: number;
  pushTokensDeleted: number; reportsDeleted: number; userDocDeleted: boolean;
  authAccountDeleted: boolean; errors: string[];
};
export class SupabaseAccountDeletionError extends Error {
  constructor(message: string) { super(message); this.name = "AccountDeletionError"; }
}

function confirmedSummary(value: unknown): value is SupabaseDeletionSummary {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return s.userDocDeleted === true && s.authAccountDeleted === true &&
    Array.isArray(s.errors) && s.errors.every((e) => typeof e === "string") &&
    ["reviewsAnonymized", "commentsAnonymized", "likesDeleted", "savedDeleted", "followsDeleted",
      "notificationsDeleted", "pushTokensDeleted", "reportsDeleted"].every((key) =>
      Number.isSafeInteger(s[key]) && (s[key] as number) >= 0);
}

export async function deleteMySupabaseAccount(): Promise<SupabaseDeletionSummary> {
  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (error || !session) throw new SupabaseAccountDeletionError("Sign in to delete your account.");
    const userId = session.user.id;
    const pinned = createIsolatedSupabaseAuthClient();
    // Pin the access token without copying/refreshing/revoking the app session.
    const { data: proof, error: proofError } = await pinned.auth.getUser(session.access_token);
    if (proofError || proof.user?.id !== userId) throw new SupabaseAccountDeletionError("Your session changed. Please try again.");
    const { data: current, error: currentError } = await supabase.auth.getSession();
    if (currentError || current.session?.user.id !== userId) throw new SupabaseAccountDeletionError("Your session changed. Please try again.");
    const { data: result, error: invokeError } = await pinned.functions.invoke("delete-account", {
      body: {}, headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (invokeError) {
      let message = "Deletion could not be confirmed. Please retry or contact support.";
      // Edge errors carry a Response; only the safe, server-authored message is used.
      const context = (invokeError as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        try { const body = await context.json(); if (typeof body?.error === "string") message = body.error; } catch { /* keep fallback */ }
      }
      throw new SupabaseAccountDeletionError(message);
    }
    if (result?.success !== true || !confirmedSummary(result.summary)) {
      throw new SupabaseAccountDeletionError(typeof result?.error === "string" ? result.error : "Unexpected deletion response. Please contact support.");
    }
    // The server has confirmed permanent deletion. Don't label it a failure if
    // local cleanup fails, and don't sign out a different, newly signed-in user.
    const summary: SupabaseDeletionSummary = { ...result.summary, errors: [...result.summary.errors] };
    try {
      const { data: now, error: checkError } = await supabase.auth.getSession();
      if (checkError) throw checkError;
      if (now.session?.user.id === userId) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;
      }
    } catch { summary.errors.push("Account deleted. Local session cleanup needs an app restart."); }
    return summary;
  } catch (err) {
    if (err instanceof SupabaseAccountDeletionError) throw err;
    throw new SupabaseAccountDeletionError("Deletion could not be confirmed. Please retry or contact support.");
  }
}
