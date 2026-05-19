// src/services/auth.ts
// Auth service — wraps Appwrite Account + users collection.
// Screens never touch Appwrite directly; they call these functions.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
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

    // 3. Create a session (so we can write the profile doc as ourselves)
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
    const profile = profiles.documents[0] as UserDoc | undefined;
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

/**
 * Placeholder for OAuth — Phase 5.
 */
export async function loginWithGoogle(): Promise<User> {
  throw new AuthError("Google sign-in coming soon.");
}

export async function loginWithApple(): Promise<User> {
  throw new AuthError("Apple sign-in coming soon.");
}
