// src/services/posts.ts
// Community posts data layer — text posts (with optional photos) that show in
// the community feed alongside reviews. Mirrors the reviews service patterns:
// per-document permissions on create, throwing list functions for the feed,
// URL rejection on the client (defense in depth lives server-side).
//
// The feature is OPTIONAL: when the posts collection id env var is unset,
// postsEnabled() is false and the compose FAB / feed merge simply don't render.
//
// ── Appwrite Console setup (one-time) ───────────────────────────────────────
//   Collection: "posts" (any id — put it in EXPO_PUBLIC_APPWRITE_POSTS_COLLECTION_ID)
//   Attributes:
//     userId    string(64)   required
//     text      string(1000) required
//     imageIds  string(64)   array (optional)
//   Indexes:
//     key on userId (for the Following feed query)
//   Settings: Document security ON.
//   Permissions (collection level): Create → Users.
//   (Read/update/delete are granted per-document on create, like reviews.)

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { captureError } from "@/services/sentry";
import type { CreatePostInput, Post, PostPage } from "@/types/post";
import { URL_REJECTION_MESSAGE, containsUrl } from "@/utils/contentValidation";

export const POST_MAX_LENGTH = 500;
export const POST_MAX_IMAGES = 4;

/** Whether the posts collection is configured. Gates the FAB + feed merge. */
export function postsEnabled(): boolean {
  return !!appwriteConfig.collections.posts;
}

// ---------- Errors ----------

export class PostError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PostError";
  }
}

function toPostError(err: unknown, fallback: string): PostError {
  if (err instanceof AppwriteException) {
    return new PostError(err.message || fallback, err.type);
  }
  return new PostError(fallback);
}

// ---------- Mapping ----------

interface PostDoc {
  $id: string;
  $createdAt: string;
  userId: string;
  text: string;
  imageIds: string[];
}

function mapDoc(doc: PostDoc): Post {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    userId: doc.userId,
    text: doc.text,
    imageIds: doc.imageIds ?? [],
  };
}

// ---------- Validation ----------

function validatePostInput(input: CreatePostInput): void {
  const text = input.text.trim();
  if (!text) {
    throw new PostError("Write something first.");
  }
  if (text.length > POST_MAX_LENGTH) {
    throw new PostError(`Posts must be ${POST_MAX_LENGTH} characters or less.`);
  }
  if (containsUrl(text)) {
    throw new PostError(URL_REJECTION_MESSAGE);
  }
  if (input.imageIds && input.imageIds.length > POST_MAX_IMAGES) {
    throw new PostError(`Up to ${POST_MAX_IMAGES} images per post.`);
  }
}

// ---------- Public API ----------

const PAGE_SIZE = 30;

export async function createPost(input: CreatePostInput): Promise<Post> {
  validatePostInput(input);

  let me;
  try {
    me = await account.get();
  } catch {
    throw new PostError("You must be signed in to post.");
  }

  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.posts,
      ID.unique(),
      {
        userId: me.$id,
        text: input.text.trim(),
        imageIds: input.imageIds ?? [],
      },
      [
        Permission.read(Role.users()),
        Permission.update(Role.user(me.$id)),
        Permission.delete(Role.user(me.$id)),
      ],
    );
    return mapDoc(doc as unknown as PostDoc);
  } catch (err) {
    captureError(err, { service: "posts", op: "createPost" });
    throw toPostError(err, "Failed to publish your post.");
  }
}

/**
 * Fetch a single post by id. Returns null when missing/deleted OR when the
 * read fails — the detail screen treats null as "post is gone" and routes back.
 */
export async function getPostById(postId: string): Promise<Post | null> {
  if (!postsEnabled()) return null;
  try {
    const doc = await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.posts,
      postId,
    );
    return mapDoc(doc as unknown as PostDoc);
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) return null;
    captureError(err, { service: "posts", op: "getPostById", postId });
    return null;
  }
}

export async function deletePost(postId: string): Promise<void> {
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.posts,
      postId,
    );
  } catch (err) {
    captureError(err, { service: "posts", op: "deletePost", postId });
    throw toPostError(err, "Failed to delete the post.");
  }
}

/**
 * Latest posts across the platform — merged into the For You feed.
 * Tolerant: returns an empty page on failure (with Sentry). Posts are a
 * garnish on the review feed; their failure should never error the screen.
 */
export async function listLatestPosts(
  options: { pageSize?: number } = {},
): Promise<PostPage> {
  if (!postsEnabled()) {
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
  const { pageSize = PAGE_SIZE } = options;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.posts,
      [Query.orderDesc("$createdAt"), Query.limit(pageSize)],
    );
    const items = (res.documents as unknown as PostDoc[]).map(mapDoc);
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: items.length > 0 ? items[items.length - 1].id : null,
    };
  } catch (err) {
    captureError(err, { service: "posts", op: "listLatestPosts" });
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
}

/**
 * Recent posts from followed users — merged into the Following feed.
 * Tolerant, same policy as listLatestPosts.
 */
export async function listPostsByFollowing(
  followingIds: string[],
  options: { pageSize?: number } = {},
): Promise<PostPage> {
  if (!postsEnabled() || followingIds.length === 0) {
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
  const { pageSize = PAGE_SIZE } = options;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.posts,
      [
        Query.equal("userId", followingIds),
        Query.orderDesc("$createdAt"),
        Query.limit(pageSize),
      ],
    );
    const items = (res.documents as unknown as PostDoc[]).map(mapDoc);
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: items.length > 0 ? items[items.length - 1].id : null,
    };
  } catch (err) {
    captureError(err, {
      service: "posts",
      op: "listPostsByFollowing",
      followingCount: followingIds.length,
    });
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
}
