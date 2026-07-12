// src/services/postLikes.ts
// Like / unlike community posts.
//
// Unlike reviews, post likes carry NO denormalized counter on the post doc.
// The post is only updatable by its author (per-doc permission), so a liker
// couldn't bump a counter on it anyway. Instead the postLikes collection IS
// the source of truth for both "did I like it" and "how many likes" — counts
// are derived by querying this collection. That keeps posts fully self-
// contained (no server-side Function needed).
//
// Error handling mirrors reviewLikes: the decoration helpers (hasUserLikedPost,
// getLikedPostIds, count helpers) stay tolerant and return empty/zero on
// failure so a hiccup only means an un-filled heart for a moment, never a
// broken feed. likePost / unlikePost surface errors so the optimistic UI can
// revert.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { triggerPostLikeNotification } from "@/services/notificationTriggers";
import { getPostById, postsEnabled } from "@/services/posts";
import { captureError } from "@/services/sentry";
import type { Post } from "@/types/post";

export class PostLikeError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PostLikeError";
  }
}

interface LikeDoc {
  $id: string;
  $createdAt: string;
  postId: string;
  userId: string;
}

/** Whether post likes are configured (collection env set). */
export function postLikesEnabled(): boolean {
  return !!appwriteConfig.collections.postLikes;
}

async function currentUserId(): Promise<string> {
  try {
    return (await account.get()).$id;
  } catch {
    throw new PostLikeError("You must be signed in.");
  }
}

/**
 * Like a post. Idempotent: returns silently if already liked or if a
 * concurrent tap wins the unique-index race.
 */
export async function likePost(postId: string): Promise<void> {
  if (!postLikesEnabled()) return;
  let me: { $id: string; name?: string };
  try {
    me = await account.get();
  } catch {
    throw new PostLikeError("You must be signed in.");
  }
  const uid = me.$id;

  if (await hasUserLikedPost(postId, uid)) return;

  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      ID.unique(),
      { postId, userId: uid },
      [Permission.read(Role.users()), Permission.delete(Role.user(uid))],
    );
  } catch (err) {
    // Unique-index violation = another tap already created it. No-op.
    if (
      err instanceof AppwriteException &&
      (err.code === 409 || err.type === "document_already_exists")
    ) {
      return;
    }
    captureError(err, { service: "postLikes", op: "likePost", postId });
    throw new PostLikeError("Failed to like post.");
  }

  // Notify the post's author (fire-and-forget). The trigger skips self-likes
  // and dedupes, and honors the recipient's notifyOnLike preference server-side.
  try {
    const post = await getPostById(postId);
    if (post) {
      triggerPostLikeNotification({
        recipientUserId: post.userId,
        actorId: uid,
        actorName: me.name || "Someone",
        postId,
      }).catch(() => {});
    }
  } catch {
    // Non-critical — the like already landed; notification is best-effort.
  }
}

/** Unlike a post. Idempotent: no-op if it wasn't liked. */
export async function unlikePost(postId: string): Promise<void> {
  if (!postLikesEnabled()) return;
  const uid = await currentUserId();

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      [
        Query.equal("postId", postId),
        Query.equal("userId", uid),
        Query.limit(1),
      ],
    );
    const like = res.documents[0] as unknown as LikeDoc | undefined;
    if (!like) return;
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      like.$id,
    );
  } catch (err) {
    captureError(err, { service: "postLikes", op: "unlikePost", postId });
    throw new PostLikeError("Failed to unlike post.");
  }
}

/**
 * Has the current user (or a given user) liked this post? Source of truth.
 * Tolerant: returns false on failure (an un-filled heart is better UX than
 * an error toast on every render).
 */
export async function hasUserLikedPost(
  postId: string,
  userId?: string,
): Promise<boolean> {
  if (!postLikesEnabled()) return false;
  let uid = userId;
  if (!uid) {
    try {
      uid = (await account.get()).$id;
    } catch {
      return false;
    }
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      [
        Query.equal("postId", postId),
        Query.equal("userId", uid),
        Query.limit(1),
      ],
    );
    return res.documents.length > 0;
  } catch (err) {
    captureError(err, { service: "postLikes", op: "hasUserLikedPost", postId });
    return false;
  }
}

/**
 * The like count for a single post (the collection's match total). Tolerant:
 * returns 0 on failure.
 */
export async function getPostLikeCount(postId: string): Promise<number> {
  if (!postLikesEnabled()) return 0;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      [Query.equal("postId", postId), Query.limit(1)],
    );
    return res.total;
  } catch (err) {
    captureError(err, { service: "postLikes", op: "getPostLikeCount", postId });
    return 0;
  }
}

/**
 * Which of these posts has the current user liked? One query for the whole
 * feed page. Tolerant: returns an empty set on failure.
 */
export async function getLikedPostIds(
  postIds: string[],
): Promise<Set<string>> {
  if (!postLikesEnabled() || postIds.length === 0) return new Set();
  let uid: string;
  try {
    uid = (await account.get()).$id;
  } catch {
    return new Set();
  }
  const unique = Array.from(new Set(postIds));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      [
        Query.equal("userId", uid),
        Query.equal("postId", unique),
        Query.limit(unique.length),
      ],
    );
    return new Set(
      res.documents.map((d) => (d as unknown as LikeDoc).postId),
    );
  } catch (err) {
    captureError(err, {
      service: "postLikes",
      op: "getLikedPostIds",
      count: postIds.length,
    });
    return new Set();
  }
}

// Cap on how many like rows we tally for a single feed page. Well beyond any
// realistic per-page total; mirrors the review-stats batch cap.
const COUNT_SCAN_CAP = 5000;

/**
 * Like counts for many posts at once, keyed by postId. One query for the whole
 * page: fetch the matching like rows and tally client-side. Tolerant: returns
 * an empty map on failure (posts then render with a 0 count).
 */
export async function getPostLikeCounts(
  postIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!postLikesEnabled() || postIds.length === 0) return counts;
  const unique = Array.from(new Set(postIds));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      [
        Query.equal("postId", unique),
        Query.select(["postId"]),
        Query.limit(COUNT_SCAN_CAP),
      ],
    );
    for (const doc of res.documents) {
      const pid = (doc as unknown as LikeDoc).postId;
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    captureError(err, {
      service: "postLikes",
      op: "getPostLikeCounts",
      count: postIds.length,
    });
    return counts;
  }
}

// ---------- Liked posts (profile Likes tab) ----------

// Local mirror of posts.ts's doc shape — the mapper there isn't exported and
// this is only five fields.
interface LikedPostDoc {
  $id: string;
  $createdAt: string;
  userId: string;
  text: string;
  imageIds: string[];
}

export interface LikedPostsPage {
  items: Post[];
  /** ISO time the user liked each post, keyed by post id. */
  likedAt: Map<string, string>;
  hasMore: boolean;
  nextCursor: string | null;
}

const EMPTY_LIKED_PAGE: LikedPostsPage = {
  items: [],
  likedAt: new Map(),
  hasMore: false,
  nextCursor: null,
};

/**
 * Posts a user has liked, most-recently-liked first — mirrors
 * reviewLikes.listLikedReviewsByUser (pagination lives on the postLikes
 * rows; the cursor is a postLikes row $id, opaque to callers).
 *
 * Tolerant: returns an empty page on failure so the profile Likes tab can
 * still show liked reviews when the posts half hiccups (posts are the
 * secondary content there).
 */
export async function listLikedPostsByUser(
  userId: string,
  options: { pageSize?: number; cursor?: string | null } = {},
): Promise<LikedPostsPage> {
  if (!postLikesEnabled() || !postsEnabled()) return EMPTY_LIKED_PAGE;
  const { pageSize = 20, cursor } = options;

  const likeQueries: string[] = [
    Query.equal("userId", userId),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) likeQueries.push(Query.cursorAfter(cursor));

  try {
    // 1. This page of postLikes rows.
    const likesRes = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postLikes,
      likeQueries,
    );
    const likeDocs = likesRes.documents as unknown as LikeDoc[];
    if (likeDocs.length === 0) return EMPTY_LIKED_PAGE;

    const postIds = likeDocs.map((l) => l.postId);
    const lastLikeId = likeDocs[likeDocs.length - 1].$id;
    const likedAt = new Map(likeDocs.map((l) => [l.postId, l.$createdAt]));

    // 2. Batch-hydrate the posts, then restore like-recency order. Posts that
    // were deleted since the like simply drop out.
    const postsRes = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.posts,
      [Query.equal("$id", postIds), Query.limit(postIds.length)],
    );
    const byId = new Map<string, Post>();
    for (const doc of postsRes.documents) {
      const d = doc as unknown as LikedPostDoc;
      byId.set(d.$id, {
        id: d.$id,
        createdAt: d.$createdAt,
        userId: d.userId,
        text: d.text,
        imageIds: d.imageIds ?? [],
      });
    }
    const items = postIds
      .map((id) => byId.get(id))
      .filter((p): p is Post => p !== undefined);

    return {
      items,
      likedAt,
      // Tracks the LIKES page (deleted posts shrink items, not pagination).
      hasMore: likeDocs.length === pageSize,
      nextCursor: lastLikeId,
    };
  } catch (err) {
    captureError(err, {
      service: "postLikes",
      op: "listLikedPostsByUser",
      userId,
    });
    return EMPTY_LIKED_PAGE;
  }
}
