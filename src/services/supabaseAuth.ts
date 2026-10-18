// Staged Supabase authentication adapter, not wired into AuthContext yet.
// Preserve the pre-signup email OTP wizard and migrate remaining Appwrite
// service contracts before activating it in the live app.

import { supabase } from "@/services/supabase";
import { mergeSupabasePreferences } from "@/services/supabaseUserPreferences";
import { acquireSupabaseSessionRefresh } from "@/services/supabaseSessionLifecycle";
import { clearCurrentSupabasePushToken } from "@/services/supabasePushTokens";
import { SupabaseAuthError } from "@/services/supabaseAuthError";
import { completeSupabaseEmailSignup } from "@/services/supabaseEmailAuth";
import { getSupabaseImageUrl } from "@/services/supabaseMediaUrls";
import { currentSupabaseSessionIdentity } from "@/services/supabasePinnedSession";
import { hasPendingSupabaseSignup, type SupabaseSignupPending } from "@/utils/supabaseSignupState";
import type { LoginInput, SignupInput, User } from "@/types/user";
import { restoreAuthSnapshot, SIGNED_OUT_SNAPSHOT, type AuthSnapshot } from "@/utils/authSession";
export { SupabaseAuthError } from "@/services/supabaseAuthError";

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  bio: string | null;
  created_at: string;
  is_banned: boolean;
  role: string;
  preferences: Record<string, unknown> | null;
  signup_pending: SupabaseSignupPending;
};

function friendlyError(error: { message: string; code?: string } | null, fallback: string) {
  const message = error?.message ?? fallback;
  if (/invalid login credentials/i.test(message)) return new SupabaseAuthError("Incorrect email or password.", error?.code);
  if (/already registered/i.test(message)) return new SupabaseAuthError("An account with that email already exists.", error?.code);
  return new SupabaseAuthError(message, error?.code);
}

function mapUser(profile: Profile, email: string, emailVerified: boolean): User {
  return {
    id: profile.id,
    email,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: getSupabaseImageUrl(profile.avatar_path),
    bio: profile.bio,
    createdAt: profile.created_at,
    emailVerified,
    isBanned: profile.is_banned,
  };
}

export async function getSupabaseCurrentUser(): Promise<User | null> {
  return (await loadSupabaseAuthSnapshot()).user;
}

/** Supabase verifies email through Auth's OTP exchange, never a client flag. */
export async function confirmSupabaseEmailVerified(): Promise<void> {
  const expected = await currentSupabaseSessionIdentity();
  if (!expected) throw new SupabaseAuthError("Your session expired. Please sign in again.", "verification_required");
  const { data, error } = await supabase.auth.getUser(expected.accessToken);
  if (error) throw friendlyError(error, "Couldn't confirm your email. Try again.");
  if (data.user?.id !== expected.userId || !data.user.email_confirmed_at) {
    throw new SupabaseAuthError("Verify your email before continuing.", "verification_required");
  }
  const current = await currentSupabaseSessionIdentity();
  if (current?.userId !== expected.userId || current.accessToken !== expected.accessToken) {
    throw new SupabaseAuthError("Your session changed. Please try again.", "session_changed");
  }
}

/** Verified identity plus role/onboarding state from a single profile query. */
export async function loadSupabaseAuthSnapshot(): Promise<AuthSnapshot> {
  const { data: local, error: localError } = await supabase.auth.getSession();
  if (localError) throw friendlyError(localError, "Couldn't restore your session.");
  if (!local.session) return { ...SIGNED_OUT_SNAPSHOT };
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) {
    if (authError.status === 401 || authError.status === 403 || authError.name === "AuthSessionMissingError") {
      return { ...SIGNED_OUT_SNAPSHOT };
    }
    throw friendlyError(authError, "Couldn't verify your session. Check your connection.");
  }
  if (!auth.user) return { ...SIGNED_OUT_SNAPSHOT };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_path, bio, created_at, is_banned, role, preferences, signup_pending:auth_signup_pending(user_id)")
    .eq("id", auth.user.id)
    .single();
  if (error || !profile) throw new SupabaseAuthError("Couldn't load your profile. Please try again.", "profile_unavailable");
  // Discard a response from the previous account if sign-out/account switching
  // happened while the verified identity or profile request was in flight.
  const { data: current, error: currentError } = await supabase.auth.getSession();
  if (currentError || current.session?.user.id !== auth.user.id) return { ...SIGNED_OUT_SNAPSHOT };

  const typed = profile as Profile;
  if (typed.id !== auth.user.id) throw new SupabaseAuthError("Couldn't load your profile. Please try again.", "profile_unavailable");
  // OAuth/email identities can exist before the username/password wizard ends.
  // A server-owned pending row survives app restarts; user metadata is not trusted.
  if (hasPendingSupabaseSignup(typed.signup_pending, auth.user.id)) return { ...SIGNED_OUT_SNAPSHOT };
  return {
    user: mapUser(typed, auth.user.email ?? "", Boolean(auth.user.email_confirmed_at)),
    isAdmin: typed.role === "admin" && !typed.is_banned,
    needsOnboarding: mergeSupabasePreferences(typed.preferences ?? {}).onboardingPending,
  };
}

export const restoreSupabaseAuthSnapshot = () => restoreAuthSnapshot(loadSupabaseAuthSnapshot);

/** No async Supabase calls inside the SDK auth callback (avoids auth-lock deadlocks). */
export function subscribeSupabaseAuthSnapshot(
  onSnapshot: (snapshot: AuthSnapshot) => void,
  onError: (error: unknown) => void = () => {},
): () => void {
  const releaseRefresh = acquireSupabaseSessionRefresh();
  let disposed = false;
  let generation = 0;
  let publishedUserId: string | null = null;
  let observedUserId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const currentGeneration = ++generation;
    if (timer !== undefined) clearTimeout(timer);
    if (!session) { publishedUserId = null; observedUserId = null; onSnapshot({ ...SIGNED_OUT_SNAPSHOT }); return; }
    // Startup restoration can publish outside this subscription. Invalidate on
    // a raw identity change even if our first deferred profile load is unfinished.
    if ((publishedUserId && publishedUserId !== session.user.id) ||
      (observedUserId && observedUserId !== session.user.id)) {
      publishedUserId = null;
      onSnapshot({ ...SIGNED_OUT_SNAPSHOT });
    }
    observedUserId = session.user.id;
    timer = setTimeout(() => {
      void loadSupabaseAuthSnapshot().then((snapshot) => {
        if (!disposed && generation === currentGeneration) { publishedUserId = snapshot.user?.id ?? null; onSnapshot(snapshot); }
      }).catch((error: unknown) => {
        if (!disposed && generation === currentGeneration) onError(error);
      });
    }, 0);
  });
  return () => {
    disposed = true;
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    data.subscription.unsubscribe();
    releaseRefresh();
  };
}

export async function loginWithSupabase({ email, password }: LoginInput): Promise<User> {
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw friendlyError(error, "Sign in failed. Please try again.");
  const expected = signedIn.user?.id;
  if (!expected) throw new SupabaseAuthError("Sign in could not be confirmed. Please try again.");

  const user = await getSupabaseCurrentUser();
  if (!user) throw new SupabaseAuthError("Logged in but couldn't load your profile. Try again.");
  if (user.id !== expected) throw new SupabaseAuthError("Your session changed. Please try again.", "session_changed");
  if (user.isBanned) {
    const current = await currentSupabaseSessionIdentity();
    if (current?.userId === expected && current.accessToken === signedIn.session?.access_token) {
      await supabase.auth.signOut({ scope: "local" });
    }
    throw new SupabaseAuthError("This account has been suspended.", "account_banned");
  }
  return user;
}

export async function signupWithSupabase({ email, password, username, displayName }: SignupInput): Promise<User> {
  await completeSupabaseEmailSignup({ email, password, username, displayName });
  const user = await getSupabaseCurrentUser();
  if (!user) throw new SupabaseAuthError("Account created but couldn't load your profile.");
  return user;
}

export async function logoutFromSupabase(): Promise<void> {
  const expected = await currentSupabaseSessionIdentity();
  if (!expected) return;
  // Best-effort device cleanup must not prevent sign-out or clear other devices.
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      clearCurrentSupabasePushToken(expected).catch(() => {}),
      new Promise<void>((resolve) => { cleanupTimer = setTimeout(resolve, 2000); }),
    ]);
  } finally {
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
  }
  const current = await currentSupabaseSessionIdentity();
  if (!current) return;
  // Don't sign out a new login. A token refresh also safely asks for a retry.
  if (current.userId !== expected.userId || current.accessToken !== expected.accessToken) {
    throw new SupabaseAuthError("Your session changed. Please try signing out again.", "session_changed");
  }
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw friendlyError(error, "Sign out failed.");
}
