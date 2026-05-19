// src/types/user.ts

export interface User {
  id: string;
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
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
}
