// src/services/reviewComments.ts
// Comments on reviews.
//
// Per-doc permissions:
//   Read: any logged-in user
//   Delete: only the comment author
//
// Counter strategy: same as reviewLikes. The reviews collection only allows
// the review's author to Update — other users can't bump commentCount
// client-side. We route bumps through the send-notification Function.
//
// Flow on add:
//   1. Fetch the parent review to get the author's userId (for notification)
//   2. Create the comment doc (source of truth)
//   3. triggerCommentNotification — Function bumps commentCount AND notifies
//
// Flow on delete:
//   1. Delete the comment doc (source of truth)
//   2. Attempt client-side decrement (will fail silently for non-authors;
//      acceptable drift, reconciled by periodic recount script)

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

  // Look up the parent review's author up front. We need this for the
  // notification trigger; the counter bump happens server-side from the
  // review ID alone.
  let reviewAuthorId: string | null = null;
  try {
    const review = (await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      input.reviewId,
    )) as unknown as ReviewAuthorDoc;
    reviewAuthorId = review.userId ?? null;
  } catch (err) {
    console.warn("[comments] failed to fetch review author:", err);
  }

  // Create the comment doc
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

  // Fire-and-forget: notification trigger handles both the push and the
  // server-side commentCount bump. Routes notification only if not a
  // self-action and not deduped.
  if (reviewAuthorId) {
    triggerCommentNotification({
      recipientUserId: reviewAuthorId,
      actorId: me.$id,
      actorName: me.name || "Someone",
      reviewId: input.reviewId,
      commentSnippet: input.text.trim(),
    }).catch((err) => {
      console.warn("[comments] notification trigger failed:", err);
    });
  }

  return mapDoc(createdDoc);
}

/**
 * Delete a comment. Only the author can delete (enforced by permissions).
 *
 * commentCount decrement is best-effort and will silently fail for
 * non-author users (i.e. anyone other than the review's owner deleting
 * their own comment). Drift accepted; reconciled by periodic recount.
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
  } catch (err) {
    throw toCommentError(err, "Failed to delete comment.");
  }

  // Best-effort decrement. Expected to fail for non-review-author users.
  try {
    const doc = (await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    )) as unknown as ReviewAuthorDoc;
    const current = doc.commentCount ?? 0;
    const next = Math.max(0, current - 1);
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
      { commentCount: next },
    );
  } catch (err) {
    // Expected for non-author users. Drift accepted.
    console.warn("[comments] commentCount decrement failed (expected):", err);
  }
}
