// src/utils/forYouRanking.ts
// Scoring algorithm for the "For You" feed.
//
// Each review is scored from a set of weighted signals. Higher score = ranks
// higher in the feed. The algorithm degrades gracefully when personalization
// signals are missing (e.g., new users without follows or saves) — falling
// back to "popular + recent" ordering.
//
// Tunable: edit WEIGHTS below to rebalance. Pure function, easy to A/B later.
//
// Signals (v1):
//   - Recency: fresher reviews get more points (decay over 7 days)
//   - Like count: social proof, capped to prevent one viral review dominating
//   - Followed author: +N if you follow the reviewer
//   - Saved restaurant: +N if you've saved the reviewed place
//   - Same parish as user: +N when user location maps to restaurant parish
//   - Quality bonus: restaurant's averageRating contributes a small lift
//   - Tiny random: breaks ties, keeps the feed feeling fresh on refresh

import type { Parish, Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";

// ─── Tunable weights ────────────────────────────────────────────────────────
// Each is the maximum points a signal can contribute. Bump these to favor
// different signals. Total max ~50 makes for predictable score ranges.
const WEIGHTS = {
  RECENCY_MAX: 10,
  LIKES_MULTIPLIER: 0.5,
  LIKES_CAP: 20, // cap likeCount at this before multiplying
  FOLLOWED_AUTHOR: 8,
  SAVED_RESTAURANT: 6,
  SAME_PARISH: 5,
  FAVORITE_CUISINE: 4, // restaurant matches a cuisine the user picked at onboarding
  FAVORITE_PARISH: 3, // restaurant is in a parish the user picked at onboarding
  QUALITY_MULTIPLIER: 0.5, // multiplied against averageRating (so ~0-2.5 pts)
  RANDOM_JITTER: 1,
} as const;

// Recency decay: full points within first hour, fades to 0 over 7 days
const RECENCY_DECAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface RankingContext {
  /** Set of userIds the current user follows */
  followedAuthorIds: Set<string>;
  /** Set of restaurantIds the current user has saved (any list) */
  savedRestaurantIds: Set<string>;
  /** User's current parish (derived from location), or null if unavailable */
  userParish: Parish | null;
  /** Lowercased cuisines/categories the user picked as favorites (onboarding). */
  favoriteCuisines?: Set<string>;
  /** Parishes the user picked as favorites (onboarding). */
  favoriteParishes?: Set<Parish>;
  /** Reference timestamp (defaults to Date.now()). Useful for testing. */
  now?: number;
}

export interface RankedFeedItem {
  review: Review;
  restaurant: Restaurant | null;
  /** Final score (higher = ranks higher). Useful for debugging. */
  score: number;
  /** Per-signal breakdown for inspecting why something ranked where it did. */
  signals: {
    recency: number;
    likes: number;
    followedAuthor: number;
    savedRestaurant: number;
    sameParish: number;
    favoriteCuisine: number;
    favoriteParish: number;
    quality: number;
    random: number;
  };
}

/**
 * Score a single review against the user context. Pure function.
 */
function scoreReview(
  review: Review,
  restaurant: Restaurant | null,
  ctx: RankingContext,
): RankedFeedItem {
  const now = ctx.now ?? Date.now();

  // Recency — decays linearly over 7 days
  const ageMs = Math.max(0, now - new Date(review.createdAt).getTime());
  const recencyFraction = Math.max(0, 1 - ageMs / RECENCY_DECAY_MS);
  const recency = recencyFraction * WEIGHTS.RECENCY_MAX;

  // Likes — capped social proof
  const cappedLikes = Math.min(review.likeCount, WEIGHTS.LIKES_CAP);
  const likes = cappedLikes * WEIGHTS.LIKES_MULTIPLIER;

  // Followed author
  const followedAuthor = ctx.followedAuthorIds.has(review.userId)
    ? WEIGHTS.FOLLOWED_AUTHOR
    : 0;

  // Saved restaurant
  const savedRestaurant = ctx.savedRestaurantIds.has(review.restaurantId)
    ? WEIGHTS.SAVED_RESTAURANT
    : 0;

  // Same parish
  const sameParish =
    restaurant && ctx.userParish && restaurant.parish === ctx.userParish
      ? WEIGHTS.SAME_PARISH
      : 0;

  // Favorite cuisine — restaurant matches one of the user's picked cuisines
  // (compared against both cuisines and categories, lowercased).
  const favCuisines = ctx.favoriteCuisines;
  const favoriteCuisine =
    restaurant &&
    favCuisines &&
    favCuisines.size > 0 &&
    [...restaurant.cuisines, ...restaurant.categories].some((c) =>
      favCuisines.has(c.toLowerCase()),
    )
      ? WEIGHTS.FAVORITE_CUISINE
      : 0;

  // Favorite parish — explicit pick, separate from the location-derived signal.
  const favoriteParish =
    restaurant &&
    ctx.favoriteParishes &&
    ctx.favoriteParishes.has(restaurant.parish)
      ? WEIGHTS.FAVORITE_PARISH
      : 0;

  // Quality (restaurant's rating)
  const quality = restaurant
    ? restaurant.averageRating * WEIGHTS.QUALITY_MULTIPLIER
    : 0;

  // Random jitter — keeps the feed feeling alive
  const random = Math.random() * WEIGHTS.RANDOM_JITTER;

  const score =
    recency +
    likes +
    followedAuthor +
    savedRestaurant +
    sameParish +
    favoriteCuisine +
    favoriteParish +
    quality +
    random;

  return {
    review,
    restaurant,
    score,
    signals: {
      recency,
      likes,
      followedAuthor,
      savedRestaurant,
      sameParish,
      favoriteCuisine,
      favoriteParish,
      quality,
      random,
    },
  };
}

/**
 * Rank a batch of reviews. Returns them sorted by score (highest first).
 *
 * Items missing their restaurant get a partial score (no quality/parish points)
 * but aren't dropped — there's still recency + likes + author info to rank on.
 */
export function rankForYou(
  items: { review: Review; restaurant: Restaurant | null }[],
  ctx: RankingContext,
): RankedFeedItem[] {
  return items
    .map(({ review, restaurant }) => scoreReview(review, restaurant, ctx))
    .sort((a, b) => b.score - a.score);
}
