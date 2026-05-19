// src/types/reviewComment.ts

export interface ReviewComment {
  id: string;
  createdAt: string;
  reviewId: string;
  restaurantId: string;
  userId: string;
  text: string;
}

export interface CreateCommentInput {
  reviewId: string;
  restaurantId: string;
  text: string;
}

export interface CommentPage {
  items: ReviewComment[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}
