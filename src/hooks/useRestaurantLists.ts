// src/hooks/useRestaurantLists.ts
// React Query hooks for the restaurant browse screens (All Spots, Map). Each is
// cached + offline-persisted and dedupes the shared live-stats fetch.

import { useQuery } from "@tanstack/react-query";

import { listRestaurants } from "@/services/restaurants";
import { getReviewStatsForRestaurants } from "@/services/reviews";
import { captureError } from "@/services/sentry";
import type { Restaurant } from "@/types/restaurant";
import { mergeReviewStats } from "@/utils/restaurantStats";

const FETCH_PAGE_SIZE = 50;
const MAX_ITEMS = 300;
const MAX_FETCHES = 12;

/** Merge live review stats onto a list. Decorative — returns input on failure. */
export async function mergeLiveStats(
  items: Restaurant[],
): Promise<Restaurant[]> {
  if (items.length === 0) return items;
  try {
    const statsMap = await getReviewStatsForRestaurants(items.map((r) => r.id));
    return mergeReviewStats(items, statsMap);
  } catch (err) {
    captureError(err, { hook: "useRestaurantLists", op: "mergeLiveStats" });
    return items;
  }
}

// Pull the whole catalogue by following the cursor, capped at MAX_ITEMS.
async function fetchAllRestaurants(): Promise<Restaurant[]> {
  const all: Restaurant[] = [];
  let cursor: string | null = null;
  let fetches = 0;
  do {
    const page = await listRestaurants(
      cursor
        ? { pageSize: FETCH_PAGE_SIZE, sort: "recent", cursor }
        : { pageSize: FETCH_PAGE_SIZE, sort: "recent" },
    );
    all.push(...page.items);
    cursor = page.hasMore ? page.nextCursor : null;
    fetches += 1;
  } while (cursor && all.length < MAX_ITEMS && fetches < MAX_FETCHES);
  return all;
}

/** "All Spots" — the whole catalogue with live stats merged. */
export function useAllRestaurants() {
  return useQuery({
    queryKey: ["restaurants", "all"],
    queryFn: async () => mergeLiveStats(await fetchAllRestaurants()),
  });
}
