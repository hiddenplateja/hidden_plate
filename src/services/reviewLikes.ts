// src/services/reviewLikes.ts
// Like / unlike reviews.
//
// IMPORTANT: counter drift acknowledged.
// We update reviews.likeCount from the client (Option 2). Order:
//   1. Create/delete the review_likes row (source of truth)
//   2. Increment/decrement reviews.likeCount (best effort)
// If step 2 fails, the like still exists. We log and move on.
// A periodic recount script (Phase 7+) reconciles drift.
//
// After a successful like, we also fire a notification to the review's
// author. Fire-and-forget — failures don't block the like.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { triggerLikeNotification } from "@/services/notificationTriggers";

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
  likeCount: number;
  /** Author of the review — needed to notify them when liked. */
  userId: string;
}

interface LikeDoc {
  $id: string;
  reviewId: string;
  userId: string;
  restaurantId: string;
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
    throw new ReviewLikeError("Failed to like review.");
  }

  // 2. Fetch the review to get its likeCount + author. We need both:
  //   - likeCount for the counter increment below
  //   - userId (author) for the notification
  // One read serves both purposes.
  let review: ReviewDoc | null = null;
  try {
    review = (await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    )) as unknown as ReviewDoc;
  } catch (err) {
    console.warn("[reviewLikes] failed to fetch review for like:", err);
  }

  // 3. Increment counter (best effort)
  if (review) {
    try {
      await databases.updateDocument(
        appwriteConfig.databaseId,
        appwriteConfig.collections.reviews,
        reviewId,
        { likeCount: (review.likeCount ?? 0) + 1 },
      );
    } catch (err) {
      console.warn("[reviewLikes] counter increment failed:", err);
    }
  }

  // 4. Notify the review author (fire-and-forget).
  // The trigger handles self-skip + dedupe + Function invocation internally.
  if (review?.userId) {
    triggerLikeNotification({
      recipientUserId: review.userId,
      actorId: me.id,
      actorName: me.name,
      reviewId,
    }).catch((err) => {
      console.warn("[reviewLikes] notification trigger failed:", err);
    });
  }
}

export async function unlikeReview(reviewId: string): Promise<void> {
  const me = await getCurrentUser();

  // 1. Find and delete the like row
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
    throw new ReviewLikeError("Failed to unlike review.");
  }

  // 2. Decrement counter (best effort). No notification on unlike.
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
    console.warn("[reviewLikes] counter decrement failed:", err);
  }
}

/**
 * Has the current user (or a given user) liked this review?
 * Source of truth — never trust the counter for this check.
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
  } catch {
    return false;
  }
}

/**
 * Get the set of review IDs the current user has liked from a given list.
 * Used when rendering a list of reviews — one query instead of N.
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
  } catch {
    return new Set();
  }
}
