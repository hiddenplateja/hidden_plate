import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { supabase } from "@/services/supabase";
import { assertSupabaseDataSession, requireSupabaseDataSession, rpcForSupabaseDataSession } from "@/services/supabaseDataRequest";
import { getSupabaseCurrentUser } from "@/services/supabaseAuth";
import { SupabaseAuthError, throwSupabaseAuthError } from "@/services/supabaseAuthError";
import { setLastOAuth } from "@/services/lastOAuth";
import type { OAuthProfileInput, OAuthResult } from "@/services/auth";
import { validateAuthProfile } from "@/utils/authValidation";
import { readSupabaseOAuthCode, SUPABASE_OAUTH_REDIRECT } from "@/utils/supabaseOAuthCallback";
import { hasPendingSupabaseSignup } from "@/utils/supabaseSignupState";

let oauthInProgress = false;

async function generateUsernameSuggestion(seed: string): Promise<string> {
  let base = seed.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (base.length < 3) base = `user${base}`;
  base = base.slice(0, 15);
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${Math.floor(10000 + Math.random() * 90000)}`;
    const { data, error } = await supabase.from("public_profiles").select("id").eq("username", candidate).limit(1);
    throwSupabaseAuthError(error, "Couldn't suggest a username.");
    if (!data?.length) return candidate;
  }
  // The database unique constraint, not this suggestion, decides availability.
  return `${base}${Date.now().toString().slice(-5)}`;
}

async function loginWithSupabaseOAuth(provider: "google" | "apple"): Promise<OAuthResult> {
  if (Platform.OS === "web") throw new SupabaseAuthError("Browser sign-in configuration is not ready yet.", "web_oauth_pending");
  if (oauthInProgress) throw new SupabaseAuthError("A sign-in is already in progress.");
  oauthInProgress = true;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider,
      options: { redirectTo: SUPABASE_OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    throwSupabaseAuthError(error, "Couldn't start sign-in.");
    if (!data.url) throw new SupabaseAuthError("Couldn't start sign-in.");
    if (new URL(data.url).searchParams.get("code_challenge_method") !== "s256") {
      throw new SupabaseAuthError("Secure sign-in is unavailable. Please use an updated app build.", "pkce_unavailable");
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, SUPABASE_OAUTH_REDIRECT);
    if (result.type !== "success") throw new SupabaseAuthError("Sign-in was cancelled.", "oauth_cancelled");
    const code = readSupabaseOAuthCode(result.url);
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    throwSupabaseAuthError(exchangeError, "Couldn't complete sign-in.");
    const { data: identity, error: identityError } = await supabase.auth.getUser();
    throwSupabaseAuthError(identityError, "Couldn't verify your sign-in.");
    if (!identity.user) throw new SupabaseAuthError("Sign-in expired. Please try again.");
    const userId = identity.user.id;
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("is_banned, signup_pending:auth_signup_pending(user_id)").eq("id", userId).single();
    throwSupabaseAuthError(profileError, "Couldn't load your profile.");
    if (!profile || profile.is_banned) {
      await supabase.auth.signOut({ scope: "local" });
      throw new SupabaseAuthError("This account has been suspended.", "account_banned");
    }
    const metadata = identity.user.user_metadata;
    const email = identity.user.email ?? "";
    const name = typeof metadata.full_name === "string" ? metadata.full_name.trim() : email.split("@")[0] || "New member";
    const picture = metadata.avatar_url ?? metadata.picture;
    const photoUrl = typeof picture === "string" && picture.startsWith("https://") ? picture : null;
    await setLastOAuth({ provider, name, email, photoUrl });
    if (hasPendingSupabaseSignup(profile.signup_pending, userId)) {
      return { status: "needs-username", suggestedUsername: await generateUsernameSuggestion(email.split("@")[0] || name),
        suggestedDisplayName: name.slice(0, 50), photoUrl };
    }
    const user = await getSupabaseCurrentUser();
    if (!user) throw new SupabaseAuthError("Couldn't load your profile. Please sign in again.");
    return { status: "authenticated", user };
  } finally {
    oauthInProgress = false;
  }
}

export const loginWithSupabaseGoogle = () => loginWithSupabaseOAuth("google");
export const loginWithSupabaseApple = () => loginWithSupabaseOAuth("apple");

export async function completeSupabaseOAuthSignup(input: OAuthProfileInput) {
  const profile = validateAuthProfile(input.username, input.displayName);
  const pinned = await requireSupabaseDataSession();
  const { error } = await rpcForSupabaseDataSession(pinned, "finish_auth_signup", {
    chosen_username: profile.username, chosen_display_name: profile.displayName, chosen_avatar: input.photoUrl ?? null,
  });
  throwSupabaseAuthError(error, "Couldn't finish creating your profile.");
  const user = await getSupabaseCurrentUser();
  await assertSupabaseDataSession(pinned);
  if (!user) throw new SupabaseAuthError("Couldn't load your profile. Please sign in again.");
  if (user.id !== pinned.userId) throw new SupabaseAuthError("Your session changed. Please try again.", "session_changed");
  return user;
}
