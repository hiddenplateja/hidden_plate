// src/services/reviewLikes.ts
// Like / unlike reviews.
//
// Counter strategy:
//   The reviews collection grants NO Update permission to anyone (not even
//   the author — that would let a tampered client flip isHidden / inflate
//   counters, since Appwrite doc perms are all-or-nothing). So no client can
//   update likeCount directly. We route all counter bumps through the
//   send-notification Appwrite Function, which runs server-side with an API key.
//
// Flow on like:
//   1. Create the review_likes row (source of truth)
//   2. triggerLikeNotification — Function bumps likeCount AND fires notification
//
// Flow on unlike:
//   1. Delete the review_likes row (source of truth)
//   2. Attempt client-side decrement (fails silently — see below;
//      acceptable drift, reconciled by periodic recount script)
//
// We KNOW the unlike decrement fails: reviews grant their author no update
// permission (to protect isHidden / counters — edits go through the Function),
// so no client can decrement likeCount directly. That's a trade-off: full
// server-side handling would require another Function endpoint. At current
// scale the drift is acceptable, and the next like reconciles it.
//
// Error handling:
//   - listLikedReviewsByUser (drives the Likes tab) throws on failure so
//     the screen can show an error state with retry.
//   - hasUserLiked / getLikedReviewIds stay tolerant — they decorate UI
//     (heart icons), and a false negative just means the heart shows
//     un-liked for a moment until the next refresh. Surfacing an error
//     there would be over-aggressive.
//   - The "expected to fail" counter decrement does NOT report to Sentry
//     because we'd flood the dashboard with non-bugs. Other failures do.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { triggerLikeNotification } from "@/services/notificationTriggers";
import { captureError } from "@/services/sentry";
import type { Review, ReviewPage } from "@/types/review";

export class ReviewLikeError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ReviewLikeError";
  }
}

interface ReviewDoc {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  restaurantId: string;
  userId: string;
  rating: number;
  comment: string | null;
  imageIds: string[];
  likeCount: number;
  commentCount: number;
  isEdited: boolean;
  isHidden: boolean;
}

interface LikeDoc {
  $id: string;
  $createdAt: string;
  reviewId: string;
  userId: string;
  restaurantId: string;
}

function mapReviewDoc(doc: ReviewDoc): Review {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
    restaurantId: doc.restaurantId,
    userId: doc.userId,
    rating: doc.rating,
    comment: doc.comment,
    imageIds: doc.imageIds ?? [],
    likeCount: doc.likeCount ?? 0,
    commentCount: doc.commentCount ?? 0,
    isEdited: doc.isEdited ?? false,
    isHidden: doc.isHidden ?? false,
  };
}

async function getCurrentUser(): Promise<{ id: string; name: string }> {
  try {
    const me = await account.get();
    return { id: me.$id, name: me.name || "Someone" };
  } catch {
    throw new ReviewLikeError("You must be signed in.");
  }
}

/**
 * Like a review. Idempotent: if already liked, returns silently.
 */
export async function likeReview(
  reviewId: string,
  restaurantId: string,
): Promise<void> {
  const me = await getCurrentUser();

  // Check if already liked — avoids the unique-index error path
  const existing = await hasUserLiked(reviewId, me.id);
  if (existing) return;

  // 1. Create the like row (source of truth)
  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewLikes,
      ID.unique(),
      { reviewId, userId: me.id, restaurantId },
      [Permission.read(Role.users()), Permission.delete(Role.user(me.id))],
    );
  } catch (err) {
    if (
      err instanceof AppwriteException &&
      err.type === "document_invalid_structure"
    ) {
      // Race: another tap won. That's fine.
      return;
    }
    captureError(err, {
      service: "reviewLikes",
      op: "likeReview",
      reviewId,
    });
    throw new ReviewLikeError("Failed to like review.");
  }

  // 2. Fetch the review to get the author's userId.
  // We only need this for the notification trigger — the counter bump
  // happens server-side in the Function with the review ID alone.
  let review: ReviewDoc | null = null;
  try {
    review = (await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    )) as unknown as ReviewDoc;
  } catch (err) {
    captureError(err, {
      service: "reviewLikes",
      op: "likeReview.fetchAuthor",
      reviewId,
    });
  }

  // 3. Trigger notification + server-side counter bump (fire-and-forget).
  // The trigger always bumps likeCount; it skips the notification on
  // self-actions and dedupe.
  if (review?.userId) {
    triggerLikeNotification({
      recipientUserId: review.userId,
      actorId: me.id,
      actorName: me.name,
      reviewId,
    }).catch((err) => {
      // Notification triggers are non-critical UX — counter eventually
      // reconciles, push is best-effort. Report so we know if it's
      // happening at scale, but don't surface to the user.
      captureError(err, {
        service: "reviewLikes",
        op: "likeReview.notifyTrigger",
        reviewId,
      });
    });
  }
}

export async function unlikeReview(reviewId: string): Promise<void> {
  const me = await getCurrentUser();

  // 1. Find and delete the like row (source of truth)
  let deleted = false;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewLikes,
      [
        Query.equal("reviewId", reviewId),
        Query.equal("userId", me.id),
        Query.limit(1),
      ],
    );
    const like = res.documents[0] as unknown as LikeDoc | undefined;
    if (!like) return; // wasn't liked anyway

    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewLikes,
      like.$id,
    );
    deleted = true;
  } catch (err) {
    captureError(err, {
      service: "reviewLikes",
      op: "unlikeReview",
      reviewId,
    });
    throw new ReviewLikeError("Failed to unlike review.");
  }

  // 2. Best-effort client-side decrement. Reviews grant their author no
  // update permission (edits are routed through the Function to protect
  // isHidden / counter fields), so this decrement now fails for EVERY user,
  // authors included. Acceptable drift — reconciled by the periodic recount
  // script, and any subsequent like resets likeCount to the authoritative
  // count server-side anyway.
  //
  // We deliberately DON'T captureError here. This failure is EXPECTED
  // by design — flooding Sentry with permission-denied errors on every
  // unlike would drown out real bugs.
  if (!deleted) return;
  try {
    const review = (await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    )) as unknown as ReviewDoc;

    const next = Math.max(0, (review.likeCount ?? 0) - 1);
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
      { likeCount: next },
    );
  } catch (err) {
    // Expected for non-author users. Drift accepted. No Sentry — see above.
    console.warn("[reviewLikes] counter decrement failed (expected):", err);
  }
}

/**
 * Has the current user (or a given user) liked this review?
 * Source of truth — never trust the counter for this check.
 *
 * Tolerant: returns false on failure with a Sentry report. A false
 * negative just shows an empty heart momentarily — much better UX than
 * surfacing an error toast every time the heart icon renders.
 */
export async function hasUserLiked(
  reviewId: string,
  userId?: string,
): Promise<boolean> {
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
      appwriteConfig.collections.reviewLikes,
      [
        Query.equal("reviewId", reviewId),
        Query.equal("userId", uid),
        Query.limit(1),
      ],
    );
    return res.documents.length > 0;
  } catch (err) {
    captureError(err, {
      service: "reviewLikes",
      op: "hasUserLiked",
      reviewId,
    });
    return false;
  }
}

/**
 * Get the set of review IDs the current user has liked from a given list.
 * Used when rendering a list of reviews — one query instead of N.
 *
 * Tolerant: returns empty set on failure. Same reasoning as hasUserLiked
 * — used to decorate hearts on already-rendered lists; failing closed is
 * better than blocking the entire list.
 */
export async function getLikedReviewIds(
  reviewIds: string[],
): Promise<Set<string>> {
  if (reviewIds.length === 0) return new Set();
  let userId: string;
  try {
    userId = (await account.get()).$id;
  } catch {
    return new Set();
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewLikes,
      [
        Query.equal("userId", userId),
        Query.equal("reviewId", reviewIds),
        Query.limit(reviewIds.length),
      ],
    );
    return new Set(
      res.documents.map((d) => (d as unknown as LikeDoc).reviewId),
    );
  } catch (err) {
    captureError(err, {
      service: "reviewLikes",
      op: "getLikedReviewIds",
      count: reviewIds.length,
    });
    return new Set();
  }
}

/**
 * List reviews that a given user has liked, sorted by when they liked them
 * (most recent first). Used by the Likes tab on the profile screen.
 *
 * Two queries:
 *   1. Page through reviewLikes for this user, sorted by $createdAt DESC.
 *      This gives us "most-recently-liked first" ordering — what users
 *      expect from a Likes list (vs. ordering by when the review was posted).
 *   2. Batch-fetch the corresponding review docs in one query.
 *
 * Important: the cursor here is the $id of the LAST reviewLikes row in the
 * previous page, NOT a review's $id. The pagination lives on the likes
 * collection, since that's what we're ordering by.
 *
 * Hidden reviews are filtered out client-side (cheaper than a separate
 * query — we already have the docs in hand).
 *
 * Returns the same ReviewPage shape as listReviewsByUser so it can slot
 * into the same UI patterns, plus `likedAt` — when the user liked each
 * review — so the Likes tab can merge-sort reviews with liked posts by
 * like recency. nextCursor is the reviewLikes row $id, opaque to callers —
 * just pass it back into the next call.
 *
 * Throws on failure. The Likes tab needs to surface this — silently
 * showing an empty tab when the fetch errored is misleading.
 */
export interface LikedReviewsPage extends ReviewPage {
  /** ISO time the user liked each review, keyed by review id. */
  likedAt: Map<string, string>;
}

export async function listLikedReviewsByUser(
  userId: string,
  options: { pageSize?: number; cursor?: string | null } = {},
): Promise<LikedReviewsPage> {
  const { pageSize = 20, cursor } = options;

  const likeQueries: string[] = [
    Query.equal("userId", userId),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) likeQueries.push(Query.cursorAfter(cursor));

  try {
    // 1. Get this page of reviewLikes rows.
    const likesRes = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewLikes,
      likeQueries,
    );
    const likeDocs = likesRes.documents as unknown as LikeDoc[];

    if (likeDocs.length === 0) {
      return {
        items: [],
        total: likesRes.total,
        hasMore: false,
        nextCursor: null,
        likedAt: new Map(),
      };
    }

    // Preserve the like-order (most recent first) when we hydrate reviews.
    const reviewIds = likeDocs.map((l) => l.reviewId);
    const lastLikeId = likeDocs[likeDocs.length - 1].$id;
    const likedAt = new Map(likeDocs.map((l) => [l.reviewId, l.$createdAt]));

    // 2. Batch-fetch the corresponding reviews. `Query.equal` on the doc
    // ID accepts an array, so this is one round-trip.
    const reviewsRes = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      [Query.equal("$id", reviewIds), Query.limit(reviewIds.length)],
    );

    // Build a lookup map then iterate the original reviewIds order so the
    // final list matches like-recency, not whatever order Appwrite returned.
    const byId = new Map<string, Review>();
    for (const doc of reviewsRes.documents) {
      const r = mapReviewDoc(doc as unknown as ReviewDoc);
      // Filter hidden reviews — they shouldn't appear in any feed.
      if (!r.isHidden) byId.set(r.id, r);
    }

    const items = reviewIds
      .map((id) => byId.get(id))
      .filter((r): r is Review => r !== undefined);

    return {
      items,
      total: likesRes.total,
      // hasMore tracks the LIKES page, not the reviews page — that's how
      // we know whether there are more likes to paginate through. If the
      // reviews page came back smaller (some were hidden/deleted), that's
      // fine; we still want to keep paginating.
      hasMore: likeDocs.length === pageSize,
      nextCursor: lastLikeId,
      likedAt,
    };
  } catch (err) {
    captureError(err, {
      service: "reviewLikes",
      op: "listLikedReviewsByUser",
      userId,
    });
    throw new ReviewLikeError("Couldn't load liked reviews.");
  }
}
