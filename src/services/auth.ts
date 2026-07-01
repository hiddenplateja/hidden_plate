// src/services/auth.ts
// Auth service — wraps Appwrite Account + users collection.
// Screens never touch Appwrite directly; they call these functions.

import * as WebBrowser from "expo-web-browser";
import {
  AppwriteException,
  ID,
  OAuthProvider,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { setLastOAuth } from "@/services/lastOAuth";
import { setOnboardingPending } from "@/services/userPreferences";
import type { LoginInput, SignupInput, User } from "@/types/user";

/**
 * Custom error class so the UI can distinguish auth errors from other errors.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ---------- Helpers ----------

interface UserDoc {
  $id: string;
  $createdAt: string;
  userId: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

/**
 * Map an Appwrite users-collection document to our User type.
 * Centralized so if the doc shape changes you fix one place.
 */
function mapUserDoc(doc: UserDoc, emailVerified: boolean): User {
  return {
    id: doc.userId,
    email: doc.email,
    username: doc.username,
    displayName: doc.displayName,
    avatarUrl: doc.avatarUrl ?? null,
    createdAt: doc.$createdAt,
    emailVerified,
  };
}

/**
 * Translate Appwrite errors into friendly messages.
 * Appwrite errors have a `type` field like "user_already_exists",
 * "user_invalid_credentials", etc.
 */
function toAuthError(err: unknown, fallback: string): AuthError {
  if (err instanceof AppwriteException) {
    switch (err.type) {
      case "user_already_exists":
      case "user_email_already_exists":
        return new AuthError(
          "An account with that email already exists.",
          err.type,
        );
      case "user_invalid_credentials":
        return new AuthError("Incorrect email or password.", err.type);
      case "user_not_found":
        return new AuthError("No account found with that email.", err.type);
      case "user_password_mismatch":
        return new AuthError("Incorrect password.", err.type);
      case "general_argument_invalid":
        return new AuthError(
          "Please check your input and try again.",
          err.type,
        );
      case "document_invalid_structure":
        return new AuthError("That username may already be taken.", err.type);
      default:
        return new AuthError(err.message || fallback, err.type);
    }
  }
  return new AuthError(fallback);
}

// ---------- Public API ----------

/**
 * Log in with email + password. Creates a session, returns the user.
 */
export async function login({ email, password }: LoginInput): Promise<User> {
  try {
    // A stale session can linger on the device (a failed profile load that
    // left the session intact, a reinstalled dev build, etc.). Appwrite rejects
    // creating a session while one is active, so clear it first. Ignore the
    // error when there's no active session to delete.
    try {
      await account.deleteSession("current");
    } catch {
      // no active session — proceed
    }
    await account.createEmailPasswordSession(email, password);
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthError("Logged in but couldn't load profile. Try again.");
    }
    return user;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw toAuthError(err, "Sign in failed. Please try again.");
  }
}

/**
 * Sign up. Creates Appwrite account, profile doc, and a session.
 *
 * Order matters:
 *   1. Check username isn't taken (cheap query, fails fast before creating an account)
 *   2. Create the Appwrite Account (auth identity)
 *   3. Sign in (need a session before we can write the profile doc as that user)
 *   4. Create the users-collection document with proper permissions
 *   5. Return the user
 *
 * If step 4 fails, we have an orphaned Account. Cleanup is messy — you'd
 * typically handle that with an Appwrite Function on the user.create event.
 * For now, the unique index on username will prevent collisions and we surface
 * the error so the user knows.
 */
export async function signup({
  email,
  password,
  username,
  displayName,
}: SignupInput): Promise<User> {
  try {
    // 1. Check username availability
    const taken = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("username", username), Query.limit(1)],
    );
    if (taken.total > 0) {
      throw new AuthError("That username is already taken.");
    }

    // 2. Create the auth account
    const accountId = ID.unique();
    await account.create(accountId, email, password, displayName);

    // 3. Create a session (so we can write the profile doc as ourselves).
    //    Clear any lingering session first — Appwrite forbids creating one
    //    while a session is active.
    try {
      await account.deleteSession("current");
    } catch {
      // no active session — proceed
    }
    await account.createEmailPasswordSession(email, password);

    // 4. Create the profile document with per-document permissions:
    //    - Owner: read, update, delete
    //    - Any logged-in user: read
    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      ID.unique(),
      {
        userId: accountId,
        email,
        username,
        displayName,
        avatarUrl: null,
        bio: null,
      },
      [
        Permission.read(Role.users()),
        Permission.update(Role.user(accountId)),
        Permission.delete(Role.user(accountId)),
      ],
    );

    // The email was already proven via OTP before this screen — mark the new
    // account verified now. Best-effort: if it fails (e.g. the proof window
    // lapsed) the account stays unverified and the root gate prompts a
    // re-verify rather than blocking signup.
    if (emailVerificationEnabled()) {
      try {
        await confirmEmailVerified();
      } catch {
        // leave unverified — the gate handles it
      }
    }

    // New account → route through onboarding once. Best-effort flag in prefs;
    // existing users who only ever log in never get it.
    try {
      await setOnboardingPending(true);
    } catch {
      // non-fatal — worst case they skip the personalization step
    }

    // 5. Return the fully-formed User
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthError("Account created but couldn't load profile.");
    }
    return user;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw toAuthError(err, "Sign up failed. Please try again.");
  }
}

// ---------- Email verification (OTP via the worker + Resend) ----------
//
// Appwrite Cloud's custom SMTP is paywalled, so instead of Appwrite's Email OTP
// we run the OTP ourselves on the Cloudflare Worker: it generates the code,
// stores a hash, emails it through Resend, and on success marks the account's
// email verified via Appwrite's admin Users API. The app just relays a
// short-lived Appwrite JWT so the worker knows (and trusts) who's asking.

const EMAIL_OTP_URL = process.env.EXPO_PUBLIC_EMAIL_OTP_URL ?? "";

/**
 * Whether email verification is enabled — true once the worker email endpoint
 * is configured. OFF by default so the flow stays dormant (no lockouts) until
 * the worker + Resend are live.
 */
export function emailVerificationEnabled(): boolean {
  return !!EMAIL_OTP_URL;
}

// Low-level POST to a worker email endpoint. Resolves on success, throws
// AuthError(message) on any failure (network or a non-2xx with a JSON message).
async function postOtp(
  path: "send" | "verify" | "confirm" | "reset-send" | "reset",
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${EMAIL_OTP_URL}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Check your connection and try again.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new AuthError(data?.message || fallbackMessage);
  }
}

// Mint a short-lived Appwrite JWT. Only succeeds when a session exists.
async function mintJwt(): Promise<string> {
  const { jwt } = await account.createJWT();
  return jwt;
}

/**
 * Send (or resend) a 6-digit verification code to `email`.
 * No account is required — this is called during signup before the account
 * exists. If a session happens to exist (the existing-user re-verify gate), we
 * also pass a JWT so the worker skips its "email already registered" guard.
 */
export async function sendEmailOtp(email: string): Promise<void> {
  let jwt: string | undefined;
  try {
    jwt = await mintJwt();
  } catch {
    jwt = undefined; // no session yet (signup) — send by email alone
  }
  await postOtp(
    "send",
    { email, ...(jwt ? { jwt } : {}) },
    "Couldn't send the code. Try again.",
  );
}

/**
 * Verify the 6-digit code for `email`. On success the worker flags the email as
 * proven (a short window opens to finish signup); the account itself is marked
 * verified later via `confirmEmailVerified`.
 */
export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<void> {
  await postOtp(
    "verify",
    { email, code },
    "That code didn't work. Try again or request a new one.",
  );
}

/**
 * Mark the *current* account's email verified. Call once a session exists and
 * the account's email has already passed `verifyEmailOtp` — i.e. right after
 * account creation during signup, or from the existing-user verify gate.
 */
export async function confirmEmailVerified(): Promise<void> {
  let jwt: string;
  try {
    jwt = await mintJwt();
  } catch (err) {
    throw toAuthError(err, "Your session expired. Please sign in again.");
  }
  await postOtp("confirm", { jwt }, "Couldn't confirm your email. Try again.");
}

// ---------- Password reset (OTP via the worker + Resend) ----------
//
// Same rationale as email verification: no Appwrite SMTP, so the worker owns the
// code. Reset differs from signup in two ways the worker must handle:
//   1. The email IS already registered (signup's /send rejects that), so reset
//      gets its own /reset-send path that looks the account up by email.
//   2. There's no session (the user is logged out and has forgotten their
//      password), so the worker uses its admin Users API key to set the new
//      password — the app never holds a session for this.
// /reset is atomic (verify code + set password in one call) so no "proven"
// window lingers for a sensitive operation.

/**
 * Whether the forgot-password flow is available. Reuses the OTP worker, so it's
 * on whenever email verification is — gates the "Forgot password?" link.
 */
export function passwordResetEnabled(): boolean {
  return !!EMAIL_OTP_URL;
}

/**
 * Send a password-reset code to an existing account's email. No session/JWT —
 * the worker's /reset-send path resolves the account by email and emails a code.
 * Throws AuthError on failure (e.g. no account with that email).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await postOtp(
    "reset-send",
    { email },
    "Couldn't send the reset code. Try again.",
  );
}

/**
 * Complete a password reset. The worker verifies the code and, with its admin
 * Users API key, sets the new password; the code is then consumed. Throws
 * AuthError on a bad/expired code or any other failure.
 */
export async function resetPassword(
  email: string,
  code: string,
  password: string,
): Promise<void> {
  await postOtp(
    "reset",
    { email, code, password },
    "Couldn't reset your password. Check the code and try again.",
  );
}

/**
 * Change the current user's password.
 * Appwrite requires the OLD password as confirmation — this is a security
 * feature that prevents anyone with a stolen session token from locking
 * the real user out of their account.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  try {
    await account.updatePassword(newPassword, oldPassword);
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Common errors with helpful messages:
      if (err.code === 401 || err.type === "user_invalid_credentials") {
        throw new AuthError("Current password is incorrect.");
      }
      if (err.code === 400 && err.message.toLowerCase().includes("password")) {
        throw new AuthError(err.message);
      }
      throw new AuthError(err.message || "Couldn't change password.");
    }
    throw new AuthError("Couldn't change password.");
  }
}

/**
 * Log out. Deletes the current session both server and client side.
 */
export async function logout(): Promise<void> {
  try {
    await account.deleteSession("current");
  } catch (err) {
    // If the session is already gone, that's fine
    if (err instanceof AppwriteException && err.code === 401) return;
    throw toAuthError(err, "Sign out failed.");
  }
}

/**
 * Restore the current user, or null if no session.
 * MUST NOT throw on "no session" — return null. AuthContext relies on this.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const me = await account.get();
    // Look up the profile doc
    const profiles = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("userId", me.$id), Query.limit(1)],
    );
    const profile = profiles.documents[0] as unknown as UserDoc | undefined;
    if (!profile) {
      // Account exists but no profile — partial signup.
      // Surface as null so the user is sent back through signup, or handle as you prefer.
      return null;
    }
    return mapUserDoc(profile, me.emailVerification);
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 401) {
      return null; // not logged in — totally normal
    }
    // Network errors and other surprises — also return null but log
    // so the app still boots into the login screen rather than crashing.
    console.warn("[auth] getCurrentUser failed:", err);
    return null;
  }
}

// ---------- OAuth (Google + Apple via Appwrite) ----------
//
// Browser-based OAuth using Appwrite's createOAuth2Token flow:
//   1. Ask Appwrite for a provider login URL that redirects back to our deep
//      link (`hiddenplate://`).
//   2. Open it in a secure in-app browser session (expo-web-browser).
//   3. On success Appwrite redirects to the deep link with ?userId&secret.
//   4. Exchange those for a real session (account.createSession).
//   5. First-time OAuth users have an Account but no users-collection doc —
//      mint one with an auto-generated unique username (editable later) and
//      route them through onboarding, like a fresh email signup.
//
// Requires the Google + Apple providers enabled in the Appwrite console and the
// app's deep link registered as a platform. See APPWRITE_SETUP.md.

/**
 * Result of an OAuth sign-in:
 *  - "authenticated": the account already had a profile → fully signed in.
 *  - "needs-username": a brand-new OAuth account (session created, but no
 *    profile doc yet) → the UI collects a username and calls
 *    completeOAuthSignup. `suggested*` prefill the picker.
 */
export type OAuthResult =
  | { status: "authenticated"; user: User }
  | {
      status: "needs-username";
      suggestedUsername: string;
      suggestedDisplayName: string;
      /** Provider profile photo (Google) to seed the avatar. null if none. */
      photoUrl: string | null;
    };

export interface OAuthProfileInput {
  username: string;
  displayName: string;
  /** Provider photo URL to use as the avatar (stored as-is). */
  photoUrl?: string | null;
}

// Pull the signed-in OAuth account's display info. For Google we also fetch the
// profile photo via the userinfo endpoint using the session's provider access
// token. Fully best-effort: any failure just means no photo (initials avatar).
async function fetchOAuthIdentity(
  provider: OAuthProvider,
  me: { name?: string; email?: string },
): Promise<{ name: string; email: string; photoUrl: string | null }> {
  const email = me.email ?? "";
  let name = me.name?.trim() ?? "";
  let photoUrl: string | null = null;

  if (provider === OAuthProvider.Google) {
    try {
      const session = await account.getSession("current");
      const token = (session as { providerAccessToken?: string })
        .providerAccessToken;
      if (token) {
        const res = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const info = (await res.json()) as {
            picture?: string;
            name?: string;
          };
          if (typeof info.picture === "string") photoUrl = info.picture;
          if (!name && typeof info.name === "string") name = info.name.trim();
        }
      }
    } catch {
      // degrade — fall back to the account name, no photo
    }
  }

  if (!name) name = email.split("@")[0] || "there";
  return { name, email, photoUrl };
}

async function loginWithOAuth(provider: OAuthProvider): Promise<OAuthResult> {
  try {
    // A lingering session blocks token creation — clear it first.
    try {
      await account.deleteSession("current");
    } catch {
      // no active session — proceed
    }

    // Native OAuth: Appwrite only accepts redirects on its own callback scheme,
    // `appwrite-callback-<projectId>` (custom app schemes / localhost are
    // rejected on a native build). The app registers this scheme in app.json
    // alongside `hiddenplate`, so the in-app browser hands the result back.
    // NOTE: changing the app.json scheme requires a fresh dev-client rebuild.
    const redirect = `appwrite-callback-${appwriteConfig.projectId}://auth`;
    if (__DEV__) {
      console.log("[oauth] redirect URI =", JSON.stringify(redirect));
    }
    const tokenUrl = await account.createOAuth2Token(
      provider,
      redirect,
      redirect,
    );
    if (!tokenUrl) throw new AuthError("Couldn't start sign-in. Try again.");

    const result = await WebBrowser.openAuthSessionAsync(
      String(tokenUrl),
      redirect,
    );
    if (result.type !== "success" || !result.url) {
      // dismiss / cancel — surface a calm message, not an error.
      throw new AuthError("Sign-in was cancelled.");
    }

    const params = new URL(result.url).searchParams;
    const userId = params.get("userId");
    const secret = params.get("secret");
    if (!userId || !secret) throw new AuthError("Sign-in failed. Try again.");

    await account.createSession(userId, secret);

    const me = await account.get();
    const identity = await fetchOAuthIdentity(provider, me);

    // Remember this identity for the "Continue as …" shortcut after logout.
    await setLastOAuth({
      provider: provider === OAuthProvider.Apple ? "apple" : "google",
      name: identity.name,
      email: identity.email,
      photoUrl: identity.photoUrl,
    });

    // Returning user → load their profile. New user → hand back a suggested
    // username + photo so the UI can show the picker (we DON'T create the doc
    // here).
    const existing = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("userId", me.$id), Query.limit(1)],
    );
    const doc = existing.documents[0] as unknown as UserDoc | undefined;
    if (doc) {
      return { status: "authenticated", user: mapUserDoc(doc, me.emailVerification) };
    }

    const seed = me.email?.split("@")[0] || identity.name || "user";
    return {
      status: "needs-username",
      suggestedUsername: await generateUniqueUsername(seed),
      suggestedDisplayName: identity.name,
      photoUrl: identity.photoUrl,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw toAuthError(err, "Sign-in failed. Please try again.");
  }
}

/**
 * Finish a first-time OAuth signup: with the OAuth session already created,
 * create the profile doc with the user's chosen username + name, then route
 * them through onboarding. Throws AuthError (e.g. username taken).
 */
export async function completeOAuthSignup(
  input: OAuthProfileInput,
): Promise<User> {
  let me;
  try {
    me = await account.get();
  } catch {
    throw new AuthError("Your sign-in expired. Please try again.");
  }

  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();

  try {
    const taken = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("username", username), Query.limit(1)],
    );
    if (taken.total > 0) {
      throw new AuthError("That username is already taken.");
    }

    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      ID.unique(),
      {
        userId: me.$id,
        email: me.email ?? "",
        username,
        displayName,
        // Provider photo URL (Google) used directly as the avatar; getAvatarUrl
        // passes absolute URLs through. null → initials fallback.
        avatarUrl: input.photoUrl ?? null,
        bio: null,
      },
      [
        Permission.read(Role.users()),
        Permission.update(Role.user(me.$id)),
        Permission.delete(Role.user(me.$id)),
      ],
    );

    // Route through onboarding once, like a fresh email signup.
    try {
      await setOnboardingPending(true);
    } catch {
      // non-fatal — worst case they skip personalization
    }

    const user = await getCurrentUser();
    if (!user) throw new AuthError("Account created but couldn't load profile.");
    return user;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw toAuthError(err, "Couldn't finish creating your account.");
  }
}

// Build a free username suggestion from a seed (email local-part or name):
// normalize to our allowed charset, then append random digits until unique.
async function generateUniqueUsername(seed: string): Promise<string> {
  let base = seed.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (base.length < 3) base = `user${base}`;
  base = base.slice(0, 16);

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate =
      attempt === 0
        ? base
        : `${base}${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 20);
    const taken = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("username", candidate), Query.limit(1)],
    );
    if (taken.total === 0) return candidate;
  }
  return `${base}${Date.now().toString().slice(-5)}`.slice(0, 20);
}

export async function loginWithGoogle(): Promise<OAuthResult> {
  return loginWithOAuth(OAuthProvider.Google);
}

export async function loginWithApple(): Promise<OAuthResult> {
  return loginWithOAuth(OAuthProvider.Apple);
}
