// src/services/reviews.ts
// Reviews data layer. Per-document permissions handled here.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import type {
  CreateReviewInput,
  Review,
  ReviewPage,
  UpdateReviewInput,
} from "@/types/review";

// ---------- Errors ----------

export class ReviewError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

function toReviewError(err: unknown, fallback: string): ReviewError {
  if (err instanceof AppwriteException) {
    if (err.type === "document_invalid_structure") {
      return new ReviewError(
        "You've already reviewed this restaurant.",
        err.type,
      );
    }
    return new ReviewError(err.message || fallback, err.type);
  }
  return new ReviewError(fallback);
}

// ---------- Mapping ----------

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

function mapDoc(doc: ReviewDoc): Review {
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

// ---------- Validation ----------

function validateReviewInput(
  input: CreateReviewInput | UpdateReviewInput,
): void {
  if ("rating" in input && input.rating !== undefined) {
    if (
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      throw new ReviewError("Rating must be a whole number from 1 to 5.");
    }
  }
  if ("comment" in input && input.comment) {
    if (input.comment.length > 2000) {
      throw new ReviewError("Comment must be 2000 characters or less.");
    }
  }
  if ("imageIds" in input && input.imageIds) {
    if (input.imageIds.length > 6) {
      throw new ReviewError("Up to 6 images per review.");
    }
  }
}

// ---------- Public API ----------

const PAGE_SIZE = 20;

interface ListOptions {
  cursor?: string | null;
  pageSize?: number;
  sort?: "recent" | "popular";
}

export async function listReviewsForRestaurant(
  restaurantId: string,
  options: ListOptions = {},
): Promise<ReviewPage> {
  const { cursor, pageSize = PAGE_SIZE, sort = "recent" } = options;

  const queries: string[] = [
    Query.equal("restaurantId", restaurantId),
    Query.equal("isHidden", false),
    Query.limit(pageSize),
  ];

  queries.push(
    sort === "popular"
      ? Query.orderDesc("likeCount")
      : Query.orderDesc("$createdAt"),
  );

  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      queries,
    );
    const items = (res.documents as unknown as ReviewDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    throw toReviewError(err, "Failed to load reviews.");
  }
}

export async function listReviewsByUser(
  userId: string,
  options: ListOptions = {},
): Promise<ReviewPage> {
  const { cursor, pageSize = PAGE_SIZE } = options;
  const queries: string[] = [
    Query.equal("userId", userId),
    Query.equal("isHidden", false),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      queries,
    );
    const items = (res.documents as unknown as ReviewDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    throw toReviewError(err, "Failed to load reviews.");
  }
}

/**
 * Fetch a single review by ID. Used by the dedicated comment screen.
 */
export async function getReviewById(reviewId: string): Promise<Review | null> {
  try {
    const doc = await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    );
    return mapDoc(doc as unknown as ReviewDoc);
  } catch (err) {
    console.warn("[reviews] getReviewById failed:", err);
    return null;
  }
}

/**
 * Get aggregate stats for a restaurant: total visible reviews + average.
 * Computed on demand from the reviews collection (Option C — no
 * denormalized counter on the restaurant doc, since users can't write
 * to the restaurants collection).
 *
 * Cheap query: only fetches the `rating` field, not full review docs.
 * For very popular restaurants (1000+ reviews) this would be the moment
 * to switch to a Cloud Function that maintains a counter.
 */
export async function getRestaurantReviewStats(
  restaurantId: string,
): Promise<{ count: number; average: number }> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      [
        Query.equal("restaurantId", restaurantId),
        Query.equal("isHidden", false),
        Query.limit(5000),
        Query.select(["rating"]),
      ],
    );
    const ratings = res.documents.map(
      (d) => (d as unknown as { rating: number }).rating,
    );
    const count = ratings.length;
    const average =
      count === 0 ? 0 : ratings.reduce((a, b) => a + b, 0) / count;
    return { count, average: Math.round(average * 10) / 10 };
  } catch (err) {
    console.warn("[reviews] failed to compute stats:", err);
    return { count: 0, average: 0 };
  }
}
/**
 * Batch-fetch review stats for many restaurants at once.
 *
 * One Appwrite query (filtered by restaurantId IN [...]) instead of
 * N separate per-restaurant queries. Aggregates client-side.
 *
 * Returns a Map keyed by restaurantId. Restaurants with no reviews are
 * absent from the map — callers should treat that as { count: 0, average: 0 }.
 *
 * Used by the home screen and "See all" lists to display accurate ratings
 * on restaurant cards. (The denormalized averageRating/reviewCount on the
 * restaurant doc itself is stale because no Cloud Function maintains it.)
 */
export async function getReviewStatsForRestaurants(
  restaurantIds: string[],
): Promise<Map<string, { count: number; average: number }>> {
  const result = new Map<string, { count: number; average: number }>();
  if (restaurantIds.length === 0) return result;

  const unique = Array.from(new Set(restaurantIds));

  try {
    // Fetch all reviews for these restaurants in one query.
    // We only need restaurantId + rating, so select just those fields.
    // limit 5000 handles plenty of restaurants × reviews each.
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      [
        Query.equal("restaurantId", unique),
        Query.equal("isHidden", false),
        Query.select(["restaurantId", "rating"]),
        Query.limit(5000),
      ],
    );

    // Group ratings by restaurantId
    const buckets = new Map<string, number[]>();
    for (const doc of res.documents) {
      const d = doc as unknown as { restaurantId: string; rating: number };
      const list = buckets.get(d.restaurantId);
      if (list) {
        list.push(d.rating);
      } else {
        buckets.set(d.restaurantId, [d.rating]);
      }
    }

    // Compute averages
    for (const [restaurantId, ratings] of buckets) {
      const count = ratings.length;
      const average = ratings.reduce((a, b) => a + b, 0) / count;
      result.set(restaurantId, {
        count,
        average: Math.round(average * 10) / 10,
      });
    }

    return result;
  } catch (err) {
    console.warn("[reviews] batch stats failed:", err);
    return result;
  }
}

/**
 * Create a review. Per-document permissions:
 *   - Read: any logged-in user
 *   - Update/Delete: only the author
 */
export async function createReview(input: CreateReviewInput): Promise<Review> {
  validateReviewInput(input);

  let me;
  try {
    me = await account.get();
  } catch {
    throw new ReviewError("You must be signed in to write a review.");
  }

  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      ID.unique(),
      {
        restaurantId: input.restaurantId,
        userId: me.$id,
        rating: input.rating,
        comment: input.comment ?? null,
        imageIds: input.imageIds ?? [],
        likeCount: 0,
        commentCount: 0,
        isEdited: false,
        isHidden: false,
      },
      [
        Permission.read(Role.users()),
        Permission.update(Role.user(me.$id)),
        Permission.delete(Role.user(me.$id)),
      ],
    );

    return mapDoc(doc as unknown as ReviewDoc);
  } catch (err) {
    throw toReviewError(err, "Failed to post review.");
  }
}

export async function updateReview(
  reviewId: string,
  input: UpdateReviewInput,
): Promise<Review> {
  validateReviewInput(input);

  try {
    const updates: Record<string, unknown> = { isEdited: true };
    if (input.rating !== undefined) updates.rating = input.rating;
    if (input.comment !== undefined) updates.comment = input.comment;
    if (input.imageIds !== undefined) updates.imageIds = input.imageIds;

    const doc = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
      updates,
    );
    return mapDoc(doc as unknown as ReviewDoc);
  } catch (err) {
    throw toReviewError(err, "Failed to update review.");
  }
}

export async function deleteReview(reviewId: string): Promise<void> {
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      reviewId,
    );
  } catch (err) {
    throw toReviewError(err, "Failed to delete review.");
  }
}

/**
 * Has the current user already reviewed this restaurant?
 */
export async function getMyReviewForRestaurant(
  restaurantId: string,
): Promise<Review | null> {
  let me;
  try {
    me = await account.get();
  } catch {
    return null;
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      [
        Query.equal("restaurantId", restaurantId),
        Query.equal("userId", me.$id),
        Query.limit(1),
      ],
    );
    const doc = res.documents[0] as unknown as ReviewDoc | undefined;
    return doc ? mapDoc(doc) : null;
  } catch {
    return null;
  }
}

/**
 * Compute aggregate stats for a user's reviews.
 * Used by the profile screen's stats row.
 *
 * Cheap query: only fetches what we need to compute.
 */
export async function getUserReviewStats(userId: string): Promise<{
  reviewCount: number;
  averageRating: number;
  parishesVisited: number; // distinct parishes reviewed
}> {
  try {
    // First get all the user's reviews
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      [
        Query.equal("userId", userId),
        Query.equal("isHidden", false),
        Query.limit(1000),
        Query.select(["rating", "restaurantId"]),
      ],
    );

    const ratings = res.documents.map(
      (d) => (d as unknown as { rating: number }).rating,
    );
    const count = ratings.length;
    const average =
      count === 0 ? 0 : ratings.reduce((a, b) => a + b, 0) / count;

    // Count distinct parishes by looking up the restaurants
    let parishesVisited = 0;
    if (count > 0) {
      const restaurantIds = Array.from(
        new Set(
          res.documents.map(
            (d) => (d as unknown as { restaurantId: string }).restaurantId,
          ),
        ),
      );
      // Use the batch helper from restaurants service
      const { getRestaurantsByIds } = await import("@/services/restaurants");
      const restaurantMap = await getRestaurantsByIds(restaurantIds);
      const parishes = new Set<string>();
      for (const r of restaurantMap.values()) {
        parishes.add(r.parish);
      }
      parishesVisited = parishes.size;
    }

    return {
      reviewCount: count,
      averageRating: Math.round(average * 10) / 10,
      parishesVisited,
    };
  } catch (err) {
    console.warn("[reviews] user stats failed:", err);
    return { reviewCount: 0, averageRating: 0, parishesVisited: 0 };
  }
}

/**
 * List recent reviews from a set of user IDs — used for the community
 * feed's "Following" tab.
 *
 * Returns reviews from all followed users merged and sorted by date.
 * If followingIds is empty, returns an empty page immediately
 * (saves a round trip).
 */
export async function listReviewsByFollowing(
  followingIds: string[],
  options: {
    pageSize?: number;
    cursor?: string | null;
  } = {},
): Promise<ReviewPage> {
  if (followingIds.length === 0) {
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }

  const { pageSize = PAGE_SIZE, cursor } = options;

  const queries: string[] = [
    Query.equal("userId", followingIds),
    Query.equal("isHidden", false),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      queries,
    );
    const items = (res.documents as unknown as ReviewDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    console.warn("[reviews] listReviewsByFollowing failed:", err);
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
}

/**
 * List all recent reviews across the platform — used for the community
 * feed's "Latest" (FYP) tab.
 *
 * Simple chronological sort. No ranking algorithm — v1.
 */
export async function listLatestReviews(
  options: {
    pageSize?: number;
    cursor?: string | null;
  } = {},
): Promise<ReviewPage> {
  const { pageSize = PAGE_SIZE, cursor } = options;

  const queries: string[] = [
    Query.equal("isHidden", false),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviews,
      queries,
    );
    const items = (res.documents as unknown as ReviewDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    console.warn("[reviews] listLatestReviews failed:", err);
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }
}
