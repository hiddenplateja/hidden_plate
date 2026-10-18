// Staged implementation of the existing email -> six-digit OTP -> profile wizard.
// Supabase creates a provisional identity at the email step; an isolated client
// keeps it out of the app session until password + server-owned profile completion.
import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { SupabaseAuthError, throwSupabaseAuthError } from "@/services/supabaseAuthError";
import type { SignupInput } from "@/types/user";
import { assertNewAuthPassword, normalizeAuthEmail, validateAuthCode, validateAuthProfile } from "@/utils/authValidation";

let signupProof: ReturnType<typeof createIsolatedSupabaseAuthClient> | null = null;
let signupGeneration = 0;

export async function cancelSupabaseEmailSignup(): Promise<void> {
  signupGeneration++;
  const previous = signupProof;
  signupProof = null;
  if (previous) await previous.auth.signOut({ scope: "local" });
}

export async function sendSupabaseEmailOtp(email: string): Promise<void> {
  const normalized = normalizeAuthEmail(email);
  await cancelSupabaseEmailSignup();
  const client = createIsolatedSupabaseAuthClient();
  const { error } = await client.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true } });
  throwSupabaseAuthError(error, "Couldn't send the code. Try again.");
}

export async function verifySupabaseEmailOtp(email: string, code: string): Promise<void> {
  const normalized = normalizeAuthEmail(email);
  const token = validateAuthCode(code);
  const generation = ++signupGeneration;
  const client = createIsolatedSupabaseAuthClient();
  const { data, error } = await client.auth.verifyOtp({ email: normalized, token, type: "email" });
  throwSupabaseAuthError(error, "That code didn't work. Request a new one.");
  if (!data.session || data.user?.email?.toLowerCase() !== normalized) {
    throw new SupabaseAuthError("Couldn't verify your email. Request a new code.");
  }
  try {
    const { data: pending, error: pendingError } = await client.from("auth_signup_pending")
      .select("user_id").eq("user_id", data.user.id).maybeSingle();
    throwSupabaseAuthError(pendingError, "Couldn't check your signup. Try again.");
    if (!pending) throw new SupabaseAuthError("You already have an account. Sign in or reset your password.", "account_exists");
    if (generation !== signupGeneration) throw new SupabaseAuthError("This verification was cancelled. Request a new code.");
    const previous = signupProof;
    signupProof = client;
    if (previous) await previous.auth.signOut({ scope: "local" });
  } catch (error) {
    await client.auth.signOut({ scope: "local" });
    throw error;
  }
}

export async function completeSupabaseEmailSignup(input: SignupInput): Promise<void> {
  const email = normalizeAuthEmail(input.email);
  const profile = validateAuthProfile(input.username, input.displayName);
  assertNewAuthPassword(input.password);
  const client = signupProof;
  const generation = signupGeneration;
  if (!client) throw new SupabaseAuthError("Verify your email before creating your account.", "verification_required");
  const { data: identity, error: identityError } = await client.auth.getUser();
  throwSupabaseAuthError(identityError, "Your verification expired. Request a new code.");
  if (!identity.user?.email_confirmed_at || identity.user.email?.toLowerCase() !== email) {
    throw new SupabaseAuthError("Verify this email before creating your account.", "verification_required");
  }
  // Check again immediately before setting a password: never mutate a completed
  // account that happened to verify an OTP through the signup screen.
  const { data: pending, error: pendingError } = await client.from("auth_signup_pending")
    .select("user_id").eq("user_id", identity.user.id).maybeSingle();
  throwSupabaseAuthError(pendingError, "Couldn't check your signup.");
  if (!pending) throw new SupabaseAuthError("This account is already set up. Please sign in.", "account_exists");
  if (generation !== signupGeneration) throw new SupabaseAuthError("Signup was cancelled. Verify your email again.");
  const { error: passwordError } = await client.auth.updateUser({ password: input.password });
  throwSupabaseAuthError(passwordError, "Couldn't set your password.");
  const { error: profileError } = await client.rpc("finish_auth_signup", {
    chosen_username: profile.username, chosen_display_name: profile.displayName, chosen_avatar: null,
  });
  throwSupabaseAuthError(profileError, "Couldn't finish creating your profile.");
  const { data: current, error: sessionError } = await client.auth.getSession();
  throwSupabaseAuthError(sessionError, "Your session expired. Sign in with your new password.");
  if (!current.session || generation !== signupGeneration) throw new SupabaseAuthError("Sign in with your new password to continue.");
  const { error } = await supabase.auth.setSession({
    access_token: current.session.access_token, refresh_token: current.session.refresh_token,
  });
  throwSupabaseAuthError(error, "Account created. Sign in with your new password.");
  // Do NOT revoke this session: it has been transferred to the main client.
  signupProof = null;
}

export async function requestSupabasePasswordReset(email: string): Promise<void> {
  const client = createIsolatedSupabaseAuthClient();
  const { error } = await client.auth.resetPasswordForEmail(normalizeAuthEmail(email));
  // Supabase returns a neutral response for an unknown address.
  throwSupabaseAuthError(error, "Couldn't send the reset code. Try again.");
}

export async function resetSupabasePassword(email: string, code: string, password: string): Promise<void> {
  const normalized = normalizeAuthEmail(email);
  const token = validateAuthCode(code);
  assertNewAuthPassword(password);
  const client = createIsolatedSupabaseAuthClient();
  try {
    const { data, error } = await client.auth.verifyOtp({ email: normalized, token, type: "recovery" });
    throwSupabaseAuthError(error, "That reset code didn't work. Request a new one.");
    if (!data.session || data.user?.email?.toLowerCase() !== normalized) throw new SupabaseAuthError("Couldn't verify the reset code.");
    const { error: updateError } = await client.auth.updateUser({ password });
    throwSupabaseAuthError(updateError, "Couldn't update your password. Request a new reset code.");
  } finally {
    // Never copy a recovery session into the main app; the existing screen goes
    // back to login. Clean up even when the password write fails.
    await client.auth.signOut({ scope: "local" }).catch(() => {});
  }
}

export async function changeSupabasePassword(oldPassword: string, newPassword: string): Promise<void> {
  assertNewAuthPassword(newPassword);
  const { data: identity, error: identityError } = await supabase.auth.getUser();
  throwSupabaseAuthError(identityError, "Your session expired. Please sign in again.");
  if (!identity.user?.email) throw new SupabaseAuthError("Please sign in again before changing your password.");
  // Verify on a separate client even if the project's require-current-password
  // switch is not yet enabled. Verification alone must not replace the main session.
  const check = createIsolatedSupabaseAuthClient();
  let transferred = false;
  try {
    const { data, error: checkError } = await check.auth.signInWithPassword({ email: identity.user.email, password: oldPassword });
    if (checkError) throw new SupabaseAuthError("Current password is incorrect.", checkError.code);
    if (data.user?.id !== identity.user.id) throw new SupabaseAuthError("Couldn't verify your current password.");
    const { data: current } = await supabase.auth.getSession();
    if (current.session?.user.id !== identity.user.id) throw new SupabaseAuthError("Your account changed. Please try again.");
    // Pin the mutation to the verified account's isolated session. Using the
    // mutable main client here could target another account after a switch.
    const { error } = await check.auth.updateUser({ password: newPassword, current_password: oldPassword });
    if (error?.code === "current_password_mismatch") throw new SupabaseAuthError("Current password is incorrect.", error.code);
    throwSupabaseAuthError(error, "Couldn't change your password.");
    const [{ data: updated, error: updatedError }, { data: active }] = await Promise.all([
      check.auth.getSession(), supabase.auth.getSession(),
    ]);
    throwSupabaseAuthError(updatedError, "Password updated. Please sign in again.");
    if (active.session?.user.id !== identity.user.id || !updated.session) {
      throw new SupabaseAuthError("Password updated for your original account. Please sign in again.");
    }
    // Password updates revoke other sessions. Adopt the verified surviving
    // session only while the original account is still active in the app.
    const { error: transferError } = await supabase.auth.setSession({
      access_token: updated.session.access_token, refresh_token: updated.session.refresh_token,
    });
    throwSupabaseAuthError(transferError, "Password updated. Please sign in again.");
    transferred = true;
  } finally {
    if (!transferred) await check.auth.signOut({ scope: "local" }).catch(() => {});
  }
}
