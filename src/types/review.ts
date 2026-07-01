// src/types/review.ts

export interface Review {
  id: string;
  createdAt: string;
  updatedAt: string;
  restaurantId: string;
  userId: string;
  rating: number; // 1-5
  comment: string | null;
  imageIds: string[];
  likeCount: number;
  commentCount: number;
  isEdited: boolean;
  isHidden: boolean;
}

export interface CreateReviewInput {
  restaurantId: string;
  rating: number;
  comment?: string;
  imageIds?: string[];
}

export interface UpdateReviewInput {
  rating?: number;
  comment?: string | null;
  imageIds?: string[];
}

export interface ReviewPage {
  items: Review[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export interface RatingDistribution {
  count: number;
  average: number;
  buckets: Record<RatingValue, number>;
}
