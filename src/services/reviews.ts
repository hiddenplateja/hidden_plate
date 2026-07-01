// src/services/reviews.ts
// Reviews data layer. Per-document permissions handled here.
//
// Content moderation:
//   - URL/external link rejection is enforced in validateReviewInput.
//     Client-side rejection is UX; the real boundary is the Appwrite
//     Function (defense in depth — modified clients can bypass JS checks).
//
// Error handling philosophy:
//   - listReviewsByFollowing / listLatestReviews THROW on failure. They
//     drive the Community feed which needs to render an error UI rather
//     than mislead the user with an empty list.
//   - Stat and "single doc" helpers stay tolerant (returning zeroes/null
//     on failure) because they're decoration — failing them should not
//     break the screen, just degrade gracefully. All failures still
//     report to Sentry so we know they're happening.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { captureError } from "@/services/sentry";
import type {
  CreateReviewInput,
  RatingDistribution,
  RatingValue,
  Review,
  ReviewPage,
  UpdateReviewInput,
} from "@/types/review";
import { URL_REJECTION_MESSAGE, containsUrl } from "@/utils/contentValidation";

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
    // Reject external links. Done here so both create + update get the check.
    if (containsUrl(input.comment)) {
      throw new ReviewError(URL_REJECTION_MESSAGE);
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
    captureError(err, {
      service: "reviews",
      op: "listReviewsForRestaurant",
      restaurantId,
    });
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
    captureError(err, {
      service: "reviews",
      op: "listReviewsByUser",
      userId,
    });
    throw toReviewError(err, "Failed to load reviews.");
  }
}

/**
 * Fetch a single review by ID. Returns null when not found OR when the
 * read fails. Callers that need to differentiate "missing" from "errored"
 * shouldn't use this helper — use databases.getDocument directly and
 * handle errors explicitly.
 *
 * Tolerant: many callers (comment screen, review detail) treat null as
 * "review was deleted" and route accordingly. Throwing would force every
 * caller to catch.
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
    captureError(err, {
      service: "reviews",
      op: "getReviewById",
      reviewId,
    });
    return null;
  }
}

/**
 * Aggregate stats for a restaurant. Tolerant: returns 0/0 on failure
 * (with Sentry report). The rating badge will show "—" or 0.0 rather
 * than the whole restaurant detail card erroring out.
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
    captureError(err, {
      service: "reviews",
      op: "getRestaurantReviewStats",
      restaurantId,
    });
    return { count: 0, average: 0 };
  }
}

/**
 * Full rating distribution for a restaurant — count, average, and a
 * per-star bucket tally (how many 5-star reviews, 4-star, etc). Powers the
 * rating histogram on the all-reviews screen.
 *
 * Tolerant like the other stat helpers: returns zeroed buckets on failure
 * (with Sentry report) so the histogram can degrade to "no ratings" rather
 * than break the screen. Reads up to 5000 ratings in one shot — same cap as
 * getRestaurantReviewStats.
 */
export async function getRestaurantRatingDistribution(
  restaurantId: string,
): Promise<RatingDistribution> {
  const emptyBuckets = (): Record<RatingValue, number> => ({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  });

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

    const buckets = emptyBuckets();
    let sum = 0;
    for (const doc of res.documents) {
      const rating = (doc as unknown as { rating: number }).rating;
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
        buckets[rating as RatingValue] += 1;
        sum += rating;
      }
    }

    // count == sum of buckets, so average and bars always agree.
    const count =
      buckets[1] + buckets[2] + buckets[3] + buckets[4] + buckets[5];
    const average = count === 0 ? 0 : sum / count;

    return { count, average: Math.round(average * 10) / 10, buckets };
  } catch (err) {
    captureError(err, {
      service: "reviews",
      op: "getRestaurantRatingDistribution",
      restaurantId,
    });
    return { count: 0, average: 0, buckets: emptyBuckets() };
  }
}

/**
 * Batch-fetch review stats for many restaurants at once. Tolerant: a
 * failure returns an empty map (with Sentry) rather than throwing.
 * Restaurants without entries in the result map render with neutral
 * defaults (count=0, average=0), which is correct UX — the card just
 * shows no rating badge instead of breaking.
 */
export async function getReviewStatsForRestaurants(
  restaurantIds: string[],
): Promise<Map<string, { count: number; average: number }>> {
  const result = new Map<string, { count: number; average: number }>();
  if (restaurantIds.length === 0) return result;

  const unique = Array.from(new Set(restaurantIds));

  try {
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
    captureError(err, {
      service: "reviews",
      op: "getReviewStatsForRestaurants",
      count: restaurantIds.length,
    });
    return result;
  }
}

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
    captureError(err, {
      service: "reviews",
      op: "createReview",
      restaurantId: input.restaurantId,
    });
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
    captureError(err, {
      service: "reviews",
      op: "updateReview",
      reviewId,
    });
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
    captureError(err, {
      service: "reviews",
      op: "deleteReview",
      reviewId,
    });
    throw toReviewError(err, "Failed to delete review.");
  }
}

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
  } catch (err) {
    captureError(err, {
      service: "reviews",
      op: "getMyReviewForRestaurant",
      restaurantId,
    });
    return null;
  }
}

/**
 * Aggregate stats for a user's reviews. Tolerant: returns zeroes on
 * failure (with Sentry) rather than throwing. The profile stat row
 * shows "0 / 0.0 / 0 parishes" rather than breaking the whole header.
 */
export async function getUserReviewStats(userId: string): Promise<{
  reviewCount: number;
  averageRating: number;
  parishesVisited: number;
}> {
  try {
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

    let parishesVisited = 0;
    if (count > 0) {
      const restaurantIds = Array.from(
        new Set(
          res.documents.map(
            (d) => (d as unknown as { restaurantId: string }).restaurantId,
          ),
        ),
      );
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
    captureError(err, {
      service: "reviews",
      op: "getUserReviewStats",
      userId,
    });
    return { reviewCount: 0, averageRating: 0, parishesVisited: 0 };
  }
}

/**
 * List recent reviews from a set of user IDs — used for the community
 * feed's "Following" tab.
 *
 * Returns reviews from all followed users merged and sorted by date.
 * If followingIds is empty, returns an empty page immediately
 * (saves a round trip — not an error case).
 *
 * Throws on failure. The Community feed needs to render an error UI.
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
    captureError(err, {
      service: "reviews",
      op: "listReviewsByFollowing",
      followingCount: followingIds.length,
    });
    throw toReviewError(err, "Couldn't load reviews from people you follow.");
  }
}

/**
 * List all recent reviews across the platform — used for the community
 * feed's "Latest" (FYP) tab.
 *
 * Simple chronological sort. No ranking algorithm — v1.
 *
 * Throws on failure. The Community feed needs to render an error UI.
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
    captureError(err, {
      service: "reviews",
      op: "listLatestReviews",
    });
    throw toReviewError(err, "Couldn't load reviews.");
  }
}
