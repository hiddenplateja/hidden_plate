// src/hooks/useHomeFeed.ts
// React Query hooks for the home tab — the canonical migration pattern.
//
// useHomeFeed replaces the hand-rolled fetchAll/useState/keep-stale plumbing:
// cached between visits (and offline via the persister), deduped, refetched in
// the background on foreground, and pull-to-refresh is just refetch() — a
// failed refresh keeps the last good data automatically.
//
// useRestaurantSearch is the SERVER-side search (whole catalogue, not just the
// 50 loaded docs) — pair it with useDebouncedValue on the raw input.

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { listRestaurants, searchRestaurants } from "@/services/restaurants";
import { getReviewStatsForRestaurants } from "@/services/reviews";
import { captureError } from "@/services/sentry";
import type { Restaurant } from "@/types/restaurant";

export interface HomeFeed {
  restaurants: Restaurant[];
  featured: Restaurant[];
}

async function fetchHomeFeed(): Promise<HomeFeed> {
  const [allPage, featuredPage] = await Promise.all([
    listRestaurants({ pageSize: 50, sort: "recent" }),
    listRestaurants({
      pageSize: 10,
      sort: "rating",
      filters: { featured: true },
    }),
  ]);

  // Stats are non-critical decoration. If this throws, fall back to whatever
  // averageRating/reviewCount the restaurant docs have (stale, not broken).
  let statsMap = new Map<string, { count: number; average: number }>();
  try {
    statsMap = await getReviewStatsForRestaurants([
      ...allPage.items.map((r) => r.id),
      ...featuredPage.items.map((r) => r.id),
    ]);
  } catch (err) {
    captureError(err, { screen: "home", op: "fetchHomeFeed.stats" });
  }

  const merge = (r: Restaurant): Restaurant => {
    const stats = statsMap.get(r.id);
    return stats
      ? { ...r, averageRating: stats.average, reviewCount: stats.count }
      : r;
  };

  return {
    restaurants: allPage.items.map(merge),
    featured: featuredPage.items.map(merge),
  };
}

export function useHomeFeed() {
  return useQuery({
    queryKey: ["home-feed"],
    queryFn: fetchHomeFeed,
  });
}

/** Debounce the term with useDebouncedValue before passing it here. */
export function useRestaurantSearch(term: string) {
  const q = term.trim().toLowerCase();
  return useQuery({
    queryKey: ["restaurant-search", q],
    queryFn: () => searchRestaurants(q),
    enabled: q.length > 0,
    staleTime: 30_000,
    // Keep showing the previous results while the next keystroke loads.
    placeholderData: keepPreviousData,
  });
}
