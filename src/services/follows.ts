// src/services/follows.ts
// Follow / unfollow + queries for follower-following relationships.
//
// Data model:
//   One document per (followerId, followingId) pair.
//   Unique compound index prevents duplicates at the DB level.
//
// Privacy model — follows are PUBLIC:
//   - Collection-level Read for Users → anyone logged in can list follows
//   - Per-doc Update/Delete restricted to the follower so only you can unfollow
//
// Rationale: matches Instagram/Twitter-style public social graphs.
// If you want to make follows private later, you'd switch to per-doc Read
// restricted to follower+following.
//
// After a successful follow, we notify the target (fire-and-forget).
// No notification on unfollow (per product spec).

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { triggerFollowNotification } from "@/services/notificationTriggers";

export class FollowError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "FollowError";
  }
}

interface RawFollowDoc {
  $id: string;
  followerId: string;
  followingId: string;
  $createdAt: string;
}

// ---------- Mutations ----------

/**
 * Follow a user. Idempotent — if you already follow them, returns silently.
 * Returns the document ID of the follow record.
 */
export async function followUser(followingId: string): Promise<string> {
  let me;
  try {
    me = await account.get();
  } catch {
    throw new FollowError("You must be signed in to follow people.");
  }

  if (me.$id === followingId) {
    throw new FollowError("You can't follow yourself.");
  }

  let createdId: string;
  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      ID.unique(),
      {
        followerId: me.$id,
        followingId,
      },
      [
        // Public read at the collection level — these per-doc permissions
        // are mainly to lock down who can DELETE the follow record
        Permission.update(Role.user(me.$id)),
        Permission.delete(Role.user(me.$id)),
      ],
    );
    createdId = doc.$id;
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Duplicate (already following) — unique index violation. Treat as success.
      if (err.code === 409) {
        const existingId = await getFollowDocId(me.$id, followingId);
        if (existingId) return existingId;
      }
      throw new FollowError(err.message || "Could not follow user.");
    }
    throw new FollowError("Could not follow user.");
  }

  // Notify the target user (fire-and-forget). Trigger handles dedupe.
  triggerFollowNotification({
    recipientUserId: followingId,
    actorId: me.$id,
    actorName: me.name || "Someone",
  }).catch((err) => {
    console.warn("[follows] notification trigger failed:", err);
  });

  return createdId;
}

/**
 * Unfollow a user. Idempotent — if you weren't following them, returns silently.
 */
export async function unfollowUser(followingId: string): Promise<void> {
  let me;
  try {
    me = await account.get();
  } catch {
    throw new FollowError("You must be signed in.");
  }

  try {
    const docId = await getFollowDocId(me.$id, followingId);
    if (!docId) return; // Not following — nothing to do

    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      docId,
    );
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Document not found = already unfollowed. Treat as success.
      if (err.code === 404) return;
      throw new FollowError(err.message || "Could not unfollow user.");
    }
    throw new FollowError("Could not unfollow user.");
  }
}

// ---------- Queries ----------

/**
 * Internal helper: find the follow doc id for a (follower, following) pair.
 * Used by unfollow to find the row to delete.
 */
async function getFollowDocId(
  followerId: string,
  followingId: string,
): Promise<string | null> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      [
        Query.equal("followerId", followerId),
        Query.equal("followingId", followingId),
        Query.limit(1),
      ],
    );
    const doc = res.documents[0] as unknown as RawFollowDoc | undefined;
    return doc?.$id ?? null;
  } catch {
    return null;
  }
}

/**
 * Does the current user follow `targetUserId`?
 */
export async function isFollowing(targetUserId: string): Promise<boolean> {
  let me;
  try {
    me = await account.get();
  } catch {
    return false;
  }
  if (me.$id === targetUserId) return false;

  const docId = await getFollowDocId(me.$id, targetUserId);
  return docId !== null;
}

/**
 * Get the list of user IDs that `followerId` follows.
 * Used by the community feed's "Following" tab.
 */
export async function getFollowingIds(
  followerId: string,
  limit = 200,
): Promise<string[]> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      [Query.equal("followerId", followerId), Query.limit(limit)],
    );
    return res.documents.map((d) => (d as unknown as RawFollowDoc).followingId);
  } catch (err) {
    console.warn("[follows] getFollowingIds failed:", err);
    return [];
  }
}

/**
 * Get the list of user IDs that follow `followingId`.
 * Used for follower lists.
 */
export async function getFollowerIds(
  followingId: string,
  limit = 200,
): Promise<string[]> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      [Query.equal("followingId", followingId), Query.limit(limit)],
    );
    return res.documents.map((d) => (d as unknown as RawFollowDoc).followerId);
  } catch (err) {
    console.warn("[follows] getFollowerIds failed:", err);
    return [];
  }
}

/**
 * Get follower / following counts for a user. Returns 0/0 on error.
 * Uses Appwrite's `total` field — efficient, doesn't actually load all docs.
 */
export async function getFollowCounts(userId: string): Promise<{
  followerCount: number;
  followingCount: number;
}> {
  try {
    const [followersRes, followingRes] = await Promise.all([
      databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.follows,
        [Query.equal("followingId", userId), Query.limit(1)],
      ),
      databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.follows,
        [Query.equal("followerId", userId), Query.limit(1)],
      ),
    ]);
    return {
      followerCount: followersRes.total,
      followingCount: followingRes.total,
    };
  } catch (err) {
    console.warn("[follows] getFollowCounts failed:", err);
    return { followerCount: 0, followingCount: 0 };
  }
}
// ---------- Hydrated list queries ----------
// These return User objects (not just IDs) and include pagination cursors.
// Used by the followers / following list screens.

import type { User } from "@/types/user";

export interface FollowListPage {
  items: User[];
  nextCursor: string | null;
  hasMore: boolean;
}

const FOLLOW_LIST_PAGE_SIZE = 30;

/**
 * Paginated list of users who follow `userId`. Hydrated with full User data.
 *
 * Sorted by when they followed (most recent first).
 *
 * Returns User objects from the users collection; deleted accounts are
 * filtered out (rather than showing "Hidden Plate user" placeholders).
 */
export async function listFollowers(
  userId: string,
  options: {
    pageSize?: number;
    cursor?: string | null;
  } = {},
): Promise<FollowListPage> {
  const { pageSize = FOLLOW_LIST_PAGE_SIZE, cursor } = options;

  const queries: string[] = [
    Query.equal("followingId", userId),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      queries,
    );
    const docs = res.documents as unknown as RawFollowDoc[];
    const userIds = docs.map((d) => d.followerId);

    if (userIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    // Hydrate user data
    const { getUsersByIds } = await import("@/services/users");
    const userMap = await getUsersByIds(userIds);

    // Preserve the follow order; drop any users we couldn't load
    const items: User[] = [];
    for (const id of userIds) {
      const u = userMap.get(id);
      if (u) items.push(u);
    }

    const lastDoc = docs[docs.length - 1];
    return {
      items,
      nextCursor: lastDoc?.$id ?? null,
      hasMore: docs.length === pageSize,
    };
  } catch (err) {
    console.warn("[follows] listFollowers failed:", err);
    return { items: [], nextCursor: null, hasMore: false };
  }
}

/**
 * Paginated list of users that `userId` follows. Hydrated with full User data.
 *
 * Sorted by when they were followed (most recent first).
 */
export async function listFollowing(
  userId: string,
  options: {
    pageSize?: number;
    cursor?: string | null;
  } = {},
): Promise<FollowListPage> {
  const { pageSize = FOLLOW_LIST_PAGE_SIZE, cursor } = options;

  const queries: string[] = [
    Query.equal("followerId", userId),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      queries,
    );
    const docs = res.documents as unknown as RawFollowDoc[];
    const userIds = docs.map((d) => d.followingId);

    if (userIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const { getUsersByIds } = await import("@/services/users");
    const userMap = await getUsersByIds(userIds);

    const items: User[] = [];
    for (const id of userIds) {
      const u = userMap.get(id);
      if (u) items.push(u);
    }

    const lastDoc = docs[docs.length - 1];
    return {
      items,
      nextCursor: lastDoc?.$id ?? null,
      hasMore: docs.length === pageSize,
    };
  } catch (err) {
    console.warn("[follows] listFollowing failed:", err);
    return { items: [], nextCursor: null, hasMore: false };
  }
}

/**
 * Batch check: which of these userIds does the current user follow?
 * Returns a Set of userIds. Used to show correct Follow/Following button
 * state on each row of the followers/following list.
 */
export async function getFollowingSetForUsers(
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  let me;
  try {
    me = await account.get();
  } catch {
    return new Set();
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.follows,
      [
        Query.equal("followerId", me.$id),
        Query.equal("followingId", userIds),
        Query.limit(userIds.length),
      ],
    );
    return new Set(
      (res.documents as unknown as RawFollowDoc[]).map((d) => d.followingId),
    );
  } catch (err) {
    console.warn("[follows] getFollowingSetForUsers failed:", err);
    return new Set();
  }
}
