// src/types/user.ts

export interface User {
  id: string;
  /**
   * Only populated for the CURRENT user (sourced from the Appwrite Account,
   * which only its owner can read). Users loaded from the users collection
   * (other people's profiles, admin lists) have `""` here — the profile doc
   * intentionally stores no email, since every signed-in user can read it.
   */
  email: string;
  username: string;
  displayName: string;
  /**
   * Either an Appwrite Storage file ID (preferred — starts with "usr_")
   * or null. Despite the name, this isn't actually a URL — it's a file ID.
   * The DB column was named this way for legacy reasons and renaming it
   * in Appwrite is painful.
   */
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt: string;
  emailVerified?: boolean;
  /** Admin moderation flag. Requires an `isBanned` attribute on the users
   *  collection; an absent attribute reads as false. */
  isBanned?: boolean;
}

export interface SignupInput {
  email: string;
  password: string;
  username: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  username?: string;
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
}
