// src/hooks/useRestaurantDetail.ts
// React Query hook for the restaurant detail screen. Fetches the restaurant +
// its reviews/authors/likes/owner-replies/saved-status/stats in one query.
//
// NOT disk-persisted (meta.persist=false): the data holds Maps/Sets
// (reviewAuthors, ownerResponses, likedIds) which the JSON AsyncStorage
// persister can't round-trip. In-memory caching still gives instant
// back-navigation and dedupes the shared stats / saved-status / user fetches.
//
// Mutations are applied optimistically to the cache via queryClient.setQueryData
// in the screen (see patchDetail there).

import { useQuery } from "@tanstack/react-query";

import { getRestaurantById } from "@/services/restaurants";
import { getLikedReviewIds } from "@/services/reviewLikes";
import { getOwnerResponsesForReviews, type ReviewResponse } from "@/services/reviewResponses";
import {
  getMyReviewForRestaurant,
  getRestaurantReviewStats,
  listReviewsForRestaurant,
} from "@/services/reviews";
import { getSavedStatus, type ListType } from "@/services/saved";
import { captureError } from "@/services/sentry";
import { getUsersByIds } from "@/services/users";
import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

const REVIEWS_PREVIEW = 3;

export interface RestaurantDetailData {
  restaurant: Restaurant;
  reviews: Review[];
  reviewAuthors: Map<string, User>;
  ownerResponses: Map<string, ReviewResponse>;
  likedIds: Set<string>;
  myReview: Review | null;
  savedStatus: Record<ListType, string | null>;
  stats: { count: number; average: number };
}

async function fetchRestaurantDetail(id: string): Promise<RestaurantDetailData> {
  // Step 1 — the critical primary. Throwing here sends the query to its error
  // state (the screen shows the ret​ryable error screen).
  const restaurant = await getRestaurantById(id);
  if (!restaurant) throw new Error("Restaurant not found.");

  // Step 2 — everything else in parallel; one failure never aborts the others.
  const [reviewsResult, myReviewResult, statsResult, savedStatusResult] =
    await Promise.allSettled([
      listReviewsForRestaurant(id, { pageSize: REVIEWS_PREVIEW }),
      getMyReviewForRestaurant(id),
      getRestaurantReviewStats(id),
      getSavedStatus(id),
    ]);

  let reviews: Review[] = [];
  if (reviewsResult.status === "fulfilled") {
    reviews = reviewsResult.value.items;
  } else {
    captureError(reviewsResult.reason, {
      screen: "restaurantDetail",
      op: "fetch.listReviewsForRestaurant",
      restaurantId: id,
    });
  }

  const myReview =
    myReviewResult.status === "fulfilled" ? myReviewResult.value : null;
  if (myReviewResult.status === "rejected") {
    captureError(myReviewResult.reason, {
      screen: "restaurantDetail",
      op: "fetch.getMyReviewForRestaurant",
      restaurantId: id,
    });
  }

  const stats =
    statsResult.status === "fulfilled"
      ? statsResult.value
      : { count: 0, average: 0 };
  if (statsResult.status === "rejected") {
    captureError(statsResult.reason, {
      screen: "restaurantDetail",
      op: "fetch.getRestaurantReviewStats",
      restaurantId: id,
    });
  }

  const savedStatus =
    savedStatusResult.status === "fulfilled"
      ? savedStatusResult.value
      : { favorite: null, want_to_go: null, visited: null };
  if (savedStatusResult.status === "rejected") {
    captureError(savedStatusResult.reason, {
      screen: "restaurantDetail",
      op: "fetch.getSavedStatus",
      restaurantId: id,
    });
  }

  // Sync the denormalized stats onto the restaurant object (no Cloud Function
  // keeps averageRating/reviewCount fresh on the doc).
  restaurant.reviewCount = stats.count;
  restaurant.averageRating = stats.average;

  // Step 3 — hydrate reviews with authors + liked-state + owner replies.
  let reviewAuthors = new Map<string, User>();
  let likedIds = new Set<string>();
  let ownerResponses = new Map<string, ReviewResponse>();
  if (reviews.length > 0) {
    const [authorsResult, likedResult, responsesResult] =
      await Promise.allSettled([
        getUsersByIds(reviews.map((r) => r.userId)),
        getLikedReviewIds(reviews.map((r) => r.id)),
        getOwnerResponsesForReviews(
          reviews.map((r) => r.id),
          restaurant.ownerId,
        ),
      ]);
    if (authorsResult.status === "fulfilled") {
      reviewAuthors = authorsResult.value;
    } else {
      captureError(authorsResult.reason, {
        screen: "restaurantDetail",
        op: "fetch.getUsersByIds",
        restaurantId: id,
      });
    }
    if (likedResult.status === "fulfilled") {
      likedIds = likedResult.value;
    } else {
      captureError(likedResult.reason, {
        screen: "restaurantDetail",
        op: "fetch.getLikedReviewIds",
        restaurantId: id,
      });
    }
    if (responsesResult.status === "fulfilled") {
      ownerResponses = responsesResult.value;
    }
  }

  return {
    restaurant,
    reviews,
    reviewAuthors,
    ownerResponses,
    likedIds,
    myReview,
    savedStatus,
    stats,
  };
}

/** Query key for the detail screen — exported so mutations can patch the cache. */
export function restaurantDetailKey(id: string | undefined) {
  return ["restaurant-detail", id] as const;
}

export function useRestaurantDetail(id: string | undefined) {
  return useQuery({
    queryKey: restaurantDetailKey(id),
    queryFn: () => fetchRestaurantDetail(id as string),
    enabled: !!id,
    meta: { persist: false },
  });
}
