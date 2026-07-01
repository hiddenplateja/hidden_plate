// src/services/reviewComments.ts
// Comments on reviews.
//
// Per-doc permissions:
//   Read: any logged-in user
//   Delete: only the comment author
//
// Counter strategy: same as reviewLikes. Routed through send-notification.
//
// Content moderation: URL rejection enforced in validateText, plus a
// server-side check inside the Function (defense in depth).

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
import { URL_REJECTION_MESSAGE, containsUrl } from "@/utils/contentValidation";

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

interface CommentDoc {
  $id: string;
  $createdAt: string;
  reviewId: string;
  restaurantId: string;
  userId: string;
  text: string;
}

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

function validateText(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new CommentError("Comment can't be empty.");
  }
  if (trimmed.length > 1000) {
    throw new CommentError("Comment must be 1000 characters or less.");
  }
  // Reject external links. Client-side check is UX; the server-side check
  // in the Appwrite Function (when text routes through it) is the boundary.
  if (containsUrl(trimmed)) {
    throw new CommentError(URL_REJECTION_MESSAGE);
  }
}

const PAGE_SIZE = 30;

interface ListOptions {
  cursor?: string | null;
  pageSize?: number;
}

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
    console.warn("[comments] commentCount decrement failed (expected):", err);
  }
}
