// src/types/post.ts
// Community text posts — non-review content shared to the feed. Distinct from
// reviews: no rating, no restaurant. Stored in their own `posts` collection.

export interface Post {
  id: string;
  createdAt: string;
  userId: string;
  text: string;
  imageIds: string[];
}

export interface CreatePostInput {
  text: string;
  imageIds?: string[];
}

export interface PostPage {
  items: Post[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/** A comment on a community post. Stored in its own `postComments` collection. */
export interface PostComment {
  id: string;
  createdAt: string;
  postId: string;
  userId: string;
  text: string;
}

export interface CreatePostCommentInput {
  postId: string;
  text: string;
}

export interface PostCommentPage {
  items: PostComment[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}
