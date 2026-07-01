// src/utils/restaurantStats.ts
// Pure merge of freshly-computed review stats onto restaurant objects.
//
// The denormalized averageRating/reviewCount on the doc go stale (no Cloud
// Function maintains them), so screens recompute stats and overlay them. This is
// that overlay, extracted so the central merge is testable and consistent.

import type { Restaurant } from "@/types/restaurant";

export interface ReviewStats {
  average: number;
  count: number;
}

/**
 * Return a new list with each restaurant's averageRating/reviewCount replaced by
 * the live stats when present. Restaurants without an entry are passed through
 * unchanged (keeping their stored values). Never mutates the inputs.
 */
export function mergeReviewStats(
  restaurants: Restaurant[],
  stats: Map<string, ReviewStats>,
): Restaurant[] {
  if (stats.size === 0) return restaurants;
  return restaurants.map((r) => {
    const s = stats.get(r.id);
    return s
      ? { ...r, averageRating: s.average, reviewCount: s.count }
      : r;
  });
}
