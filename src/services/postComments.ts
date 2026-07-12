// src/services/postComments.ts
// Comments on community posts.
//
// Per-doc permissions:
//   Read:   any logged-in user
//   Delete: only the comment author
//
// Like postLikes, comments carry NO denormalized counter on the post doc (the
// post is owner-only updatable). The postComments collection is the source of
// truth for both the thread and the count. Fully self-contained — no server
// Function involved.
//
// Content moderation: URL rejection enforced in validateText (client-side UX;
// the real boundary would be a server Function if/when post text routes
// through one).

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { triggerPostCommentNotification } from "@/services/notificationTriggers";
import { getPostById } from "@/services/posts";
import { captureError } from "@/services/sentry";
import type {
  CreatePostCommentInput,
  PostComment,
  PostCommentPage,
} from "@/types/post";
import { URL_REJECTION_MESSAGE, containsUrl } from "@/utils/contentValidation";

export class PostCommentError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PostCommentError";
  }
}

function toPostCommentError(err: unknown, fallback: string): PostCommentError {
  if (err instanceof AppwriteException) {
    return new PostCommentError(err.message || fallback, err.type);
  }
  return new PostCommentError(fallback);
}

interface CommentDoc {
  $id: string;
  $createdAt: string;
  postId: string;
  userId: string;
  text: string;
}

function mapDoc(doc: CommentDoc): PostComment {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    postId: doc.postId,
    userId: doc.userId,
    text: doc.text,
  };
}

export const POST_COMMENT_MAX_LENGTH = 1000;

/** Whether post comments are configured (collection env set). */
export function postCommentsEnabled(): boolean {
  return !!appwriteConfig.collections.postComments;
}

function validateText(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new PostCommentError("Comment can't be empty.");
  }
  if (trimmed.length > POST_COMMENT_MAX_LENGTH) {
    throw new PostCommentError(
      `Comment must be ${POST_COMMENT_MAX_LENGTH} characters or less.`,
    );
  }
  if (containsUrl(trimmed)) {
    throw new PostCommentError(URL_REJECTION_MESSAGE);
  }
}

const PAGE_SIZE = 30;

export async function listCommentsForPost(
  postId: string,
  options: { cursor?: string | null; pageSize?: number } = {},
): Promise<PostCommentPage> {
  if (!postCommentsEnabled()) {
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
  const { cursor, pageSize = PAGE_SIZE } = options;

  const queries: string[] = [
    Query.equal("postId", postId),
    Query.orderAsc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postComments,
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
    throw toPostCommentError(err, "Failed to load comments.");
  }
}

/** Fetch a single post comment by id. Returns null if missing/deleted. */
export async function getPostCommentById(
  commentId: string,
): Promise<PostComment | null> {
  if (!postCommentsEnabled()) return null;
  try {
    const doc = await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postComments,
      commentId,
    );
    return mapDoc(doc as unknown as CommentDoc);
  } catch {
    return null;
  }
}

export async function addPostComment(
  input: CreatePostCommentInput,
): Promise<PostComment> {
  if (!postCommentsEnabled()) {
    throw new PostCommentError("Commenting isn't available right now.");
  }
  validateText(input.text);

  let me;
  try {
    me = await account.get();
  } catch {
    throw new PostCommentError("You must be signed in to comment.");
  }

  const text = input.text.trim();
  let created: CommentDoc;
  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postComments,
      ID.unique(),
      {
        postId: input.postId,
        userId: me.$id,
        text,
      },
      [Permission.read(Role.users()), Permission.delete(Role.user(me.$id))],
    );
    created = doc as unknown as CommentDoc;
  } catch (err) {
    throw toPostCommentError(err, "Failed to post comment.");
  }

  // Notify the post's author (fire-and-forget). Skips self-comments + dedupes,
  // and honors notifyOnComment server-side.
  try {
    const post = await getPostById(input.postId);
    if (post) {
      triggerPostCommentNotification({
        recipientUserId: post.userId,
        actorId: me.$id,
        actorName: me.name || "Someone",
        postId: input.postId,
        commentSnippet: text,
      }).catch(() => {});
    }
  } catch {
    // Non-critical — the comment already landed; notification is best-effort.
  }

  return mapDoc(created);
}

export async function deletePostComment(commentId: string): Promise<void> {
  if (!postCommentsEnabled()) return;
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postComments,
      commentId,
    );
  } catch (err) {
    throw toPostCommentError(err, "Failed to delete comment.");
  }
}

// Cap on rows tallied per feed page — see postLikes.getPostLikeCounts.
const COUNT_SCAN_CAP = 5000;

/**
 * Comment counts for many posts at once, keyed by postId. Tolerant: returns
 * an empty map on failure (posts then render with a 0 count).
 */
export async function getPostCommentCounts(
  postIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!postCommentsEnabled() || postIds.length === 0) return counts;
  const unique = Array.from(new Set(postIds));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.postComments,
      [
        Query.equal("postId", unique),
        Query.select(["postId"]),
        Query.limit(COUNT_SCAN_CAP),
      ],
    );
    for (const doc of res.documents) {
      const pid = (doc as unknown as CommentDoc).postId;
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    captureError(err, {
      service: "postComments",
      op: "getPostCommentCounts",
      count: postIds.length,
    });
    return counts;
  }
}
