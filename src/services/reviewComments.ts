// src/services/reviewComments.ts
// Comments on reviews. Same per-doc permissions pattern as reviews:
//   Read: any logged-in user
//   Delete: only the comment author
//
// commentCount on the parent review is maintained client-side via
// read-then-write. There's a tiny race window if two people comment
// simultaneously; at current scale that's fine. Swap to a Cloud Function
// when scale demands it (same story as the rating denormalization).
//
// After a successful comment, we notify the review's author (fire-and-forget).

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { triggerCommentNotification } from "@/services/notificationTriggers";
import type {
  CommentPage,
  CreateCommentInput,
  ReviewComment,
} from "@/types/reviewComment";

// ---------- Errors ----------

export class CommentError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "CommentError";
  }
}

function toCommentError(err: unknown, fallback: string): CommentError {
  if (err instanceof AppwriteException) {
    return new CommentError(err.message || fallback, err.type);
  }
  return new CommentError(fallback);
}

// ---------- Mapping ----------

interface CommentDoc {
  $id: string;
  $createdAt: string;
  reviewId: string;
  restaurantId: string;
  userId: string;
  text: string;
}

/** Shape of the parent review doc — we only read the author here */
interface ReviewAuthorDoc {
  $id: string;
  userId: string;
  commentCount?: number;
}

function mapDoc(doc: CommentDoc): ReviewComment {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    reviewId: doc.reviewId,
    restaurantId: doc.restaurantId,
    userId: doc.userId,
    text: doc.text,
  };
}

// ---------- Validation ----------

function validateText(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new CommentError("Comment can't be empty.");
  }
  if (trimmed.length > 1000) {
    throw new CommentError("Comment must be 1000 characters or less.");
  }
}

// ---------- commentCount helpers ----------
// Read-then-write. Not atomic, but acceptable at current scale.
// Returns the review author's userId so callers can use it to send a
// notification without a second read of the same doc.

async function bumpCommentCount(
  reviewId: string,
  delta: 1 | -1,
): Promise<string | null> {
  try {
    const doc = (await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    )) as unknown as ReviewAuthorDoc;
    const current = doc.commentCount ?? 0;
    const next = Math.max(0, current + delta);
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
      { commentCount: next },
    );
    return doc.userId ?? null;
  } catch (err) {
    // Don't fail the whole comment op if the counter update fails — the
    // comment doc itself is the source of truth. We can recompute counters
    // out-of-band if they drift.
    console.warn("[comments] bumpCommentCount failed:", err);
    return null;
  }
}

// ---------- Public API ----------

const PAGE_SIZE = 30;

interface ListOptions {
  cursor?: string | null;
  pageSize?: number;
}

/**
 * List comments for a review, oldest first (chat order).
 */
export async function listCommentsForReview(
  reviewId: string,
  options: ListOptions = {},
): Promise<CommentPage> {
  const { cursor, pageSize = PAGE_SIZE } = options;

  const queries: string[] = [
    Query.equal("reviewId", reviewId),
    Query.orderAsc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewComments,
      queries,
    );
    const items = (res.documents as unknown as CommentDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    throw toCommentError(err, "Failed to load comments.");
  }
}

/**
 * Create a comment. Per-doc permissions:
 *   Read: any logged-in user
 *   Delete: only the author
 */
export async function addComment(
  input: CreateCommentInput,
): Promise<ReviewComment> {
  validateText(input.text);

  let me;
  try {
    me = await account.get();
  } catch {
    throw new CommentError("You must be signed in to comment.");
  }

  let createdDoc: CommentDoc;
  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewComments,
      ID.unique(),
      {
        reviewId: input.reviewId,
        restaurantId: input.restaurantId,
        userId: me.$id,
        text: input.text.trim(),
      },
      [Permission.read(Role.users()), Permission.delete(Role.user(me.$id))],
    );
    createdDoc = doc as unknown as CommentDoc;
  } catch (err) {
    throw toCommentError(err, "Failed to post comment.");
  }

  // Counter bump returns the review's author — reuse it for the notification
  // instead of a second read of the review doc. Both are fire-and-forget.
  bumpCommentCount(input.reviewId, 1)
    .then((reviewAuthorId) => {
      if (reviewAuthorId) {
        return triggerCommentNotification({
          recipientUserId: reviewAuthorId,
          actorId: me.$id,
          actorName: me.name || "Someone",
          reviewId: input.reviewId,
          commentSnippet: input.text.trim(),
        });
      }
    })
    .catch((err) => {
      console.warn("[comments] notification trigger failed:", err);
    });

  return mapDoc(createdDoc);
}

/**
 * Delete a comment. Only the author can delete (enforced by permissions).
 */
export async function deleteComment(
  commentId: string,
  reviewId: string,
): Promise<void> {
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewComments,
      commentId,
    );
    void bumpCommentCount(reviewId, -1);
  } catch (err) {
    throw toCommentError(err, "Failed to delete comment.");
  }
}
