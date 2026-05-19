// src/services/users.ts
// User profile data layer.

import { AppwriteException, Query } from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import type { UpdateProfileInput, User } from "@/types/user";

export class UserError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

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

function mapDoc(doc: UserDoc): User {
  return {
    id: doc.userId,
    email: doc.email,
    username: doc.username,
    displayName: doc.displayName,
    avatarUrl: doc.avatarUrl ?? null,
    bio: doc.bio ?? null,
    createdAt: doc.$createdAt,
    emailVerified: undefined,
  };
}

/**
 * Batch-fetch users by their IDs. Returns a map: userId -> User.
 * Missing users (deleted accounts) are simply absent from the map.
 */
export async function getUsersByIds(ids: string[]): Promise<Map<string, User>> {
  if (ids.length === 0) return new Map();
  const unique = Array.from(new Set(ids));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("userId", unique), Query.limit(unique.length)],
    );
    const map = new Map<string, User>();
    for (const doc of res.documents) {
      const user = mapDoc(doc as unknown as UserDoc);
      map.set(user.id, user);
    }
    return map;
  } catch (err) {
    console.warn("[users] batch fetch failed:", err);
    return new Map();
  }
}

/**
 * Get a single user by their userId (the Appwrite account ID).
 * Returns null if not found.
 */
export async function getUserById(userId: string): Promise<User | null> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("userId", userId), Query.limit(1)],
    );
    const doc = res.documents[0] as unknown as UserDoc | undefined;
    return doc ? mapDoc(doc) : null;
  } catch (err) {
    console.warn("[users] getUserById failed:", err);
    return null;
  }
}

/**
 * Update the current user's profile.
 * Updates the users-collection document, NOT the Appwrite Account.
 * (Account holds email/password; the profile doc holds everything else.)
 *
 * Returns the updated User.
 */
export async function updateMyProfile(
  input: UpdateProfileInput,
): Promise<User> {
  let me;
  try {
    me = await account.get();
  } catch {
    throw new UserError("You must be signed in.");
  }

  // Find the user's profile document
  let profileDoc;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.equal("userId", me.$id), Query.limit(1)],
    );
    profileDoc = res.documents[0];
    if (!profileDoc) throw new UserError("Profile not found.");
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError("Failed to find your profile.");
  }

  // Build the update payload — only include fields that were provided
  const updates: Record<string, unknown> = {};
  if (input.displayName !== undefined) updates.displayName = input.displayName;
  if (input.bio !== undefined) updates.bio = input.bio;
  if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;

  if (Object.keys(updates).length === 0) {
    return mapDoc(profileDoc as unknown as UserDoc);
  }

  try {
    const updated = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      profileDoc.$id,
      updates,
    );

    // Also keep the Appwrite Account's "name" in sync with displayName,
    // since it's used in places like email notifications
    if (input.displayName !== undefined) {
      try {
        await account.updateName(input.displayName);
      } catch (err) {
        console.warn("[users] account name sync failed:", err);
      }
    }

    return mapDoc(updated as unknown as UserDoc);
  } catch (err) {
    if (err instanceof AppwriteException) {
      throw new UserError(err.message || "Failed to update profile.");
    }
    throw new UserError("Failed to update profile.");
  }
}

/**
 * Validation helpers — call from the UI before submit.
 */
export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Display name is required";
  if (trimmed.length < 2) return "At least 2 characters";
  if (trimmed.length > 50) return "At most 50 characters";
  return null;
}

export function validateBio(value: string): string | null {
  if (value.length > 280) return "Bio must be 280 characters or less";
  return null;
}
// ---------- Search ----------

/**
 * Search users by username or display name.
 *
 * Strategy: run TWO fulltext queries in parallel (one against username,
 * one against displayName), then merge and dedupe. Appwrite's fulltext
 * indexes only support one field per query.
 *
 * Limitations:
 *   - Prefix matching only ("mar" finds "marcus", "marlon"; "rcus" finds nothing)
 *   - Short queries (< 2 chars) return empty — fulltext won't match single chars
 *   - Tokens are split on whitespace, so "Marcus B" searches "marcus" AND "b"
 *
 * Returns: max ~30 users, ordered roughly by relevance (Appwrite's choice).
 */
export async function searchUsers(rawQuery: string): Promise<User[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  try {
    // Strip the @ if user types @username, then search both fields in parallel
    const cleaned = query.startsWith("@") ? query.slice(1) : query;

    const [byUsername, byDisplayName] = await Promise.all([
      databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.users,
        [Query.search("username", cleaned), Query.limit(20)],
      ),
      databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.users,
        [Query.search("displayName", cleaned), Query.limit(20)],
      ),
    ]);

    // Merge + dedupe by user document ID
    const seen = new Set<string>();
    const merged: UserDoc[] = [];
    for (const doc of [...byUsername.documents, ...byDisplayName.documents]) {
      const d = doc as unknown as UserDoc;
      if (seen.has(d.userId)) continue;
      seen.add(d.userId);
      merged.push(d);
    }

    return merged.map(mapDoc);
  } catch (err) {
    console.warn("[users] searchUsers failed:", err);
    return [];
  }
}

// ---------- Suggestions ----------

/**
 * Get suggested users — approximated as "most followed" by scanning the
 * most recent follow records.
 *
 * Implementation trade-off (acceptable for v1, requires Cloud Function later):
 *   - We scan the most recent N (default 500) follow documents
 *   - Group by followingId, count occurrences = approximated follower count
 *   - This is NOT truly "most followed of all time" — only "most followed
 *     among the latest 500 follows." But it surfaces active users people
 *     are currently following, which is arguably better signal anyway.
 *   - At scale (>1000 users), replace with a denormalized `followerCount`
 *     field on the users doc maintained by a Cloud Function.
 *
 * Returns the top `limit` users, fully hydrated. Excludes the current user.
 */
export async function getSuggestedUsers(limit = 10): Promise<User[]> {
  try {
    const me = await account.get().catch(() => null);

    // Scan the most recent 500 follows
    const followsRes = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      [Query.orderDesc("$createdAt"), Query.limit(500)],
    );

    // Count how many times each followingId appears
    const counts = new Map<string, number>();
    for (const doc of followsRes.documents) {
      const d = doc as unknown as { followingId: string };
      counts.set(d.followingId, (counts.get(d.followingId) ?? 0) + 1);
    }

    // Sort by count desc, take top `limit` + a few extras to absorb the
    // "current user" filter that comes next
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([userId]) => userId)
      .filter((id) => id !== me?.$id) // exclude self
      .slice(0, limit);

    if (sorted.length === 0) {
      // No follows yet on the platform — fall back to newest users
      return getNewestUsers(limit, me?.$id);
    }

    // Hydrate user data
    const userMap = await getUsersByIds(sorted);
    const result: User[] = [];
    for (const id of sorted) {
      const u = userMap.get(id);
      if (u) result.push(u);
    }
    return result;
  } catch (err) {
    console.warn("[users] getSuggestedUsers failed:", err);
    return [];
  }
}

/**
 * Fallback: get the newest registered users.
 * Used when there are no follows yet on the platform.
 */
async function getNewestUsers(
  limit: number,
  excludeUserId?: string,
): Promise<User[]> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.users,
      [Query.orderDesc("$createdAt"), Query.limit(limit + 1)],
    );
    const users = (res.documents as unknown as UserDoc[]).map(mapDoc);
    return users.filter((u) => u.id !== excludeUserId).slice(0, limit);
  } catch (err) {
    console.warn("[users] getNewestUsers failed:", err);
    return [];
  }
}
