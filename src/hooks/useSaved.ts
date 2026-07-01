// src/hooks/useSaved.ts
// React Query hook for the Saved tab. One query per list type (favorite /
// want_to_go / visited), cached + offline-persisted. Switching tabs shows the
// previously-loaded tab instantly from cache while it revalidates, and the
// stats/getRestaurantsByIds calls dedupe with the rest of the app.

import { useQuery } from "@tanstack/react-query";

import { getReviewStatsForRestaurants } from "@/services/reviews";
import { listSavedRestaurants, type ListType } from "@/services/saved";
import { captureError } from "@/services/sentry";
import type { Restaurant } from "@/types/restaurant";

export interface SavedItem {
  savedId: string;
  /** When this saved doc was created (used for "Newest saved" sort). */
  savedAt: string;
  restaurant: Restaurant | null;
}

async function fetchSaved(type: ListType): Promise<SavedItem[]> {
  const results = await listSavedRestaurants(type);

  // Live review stats are decorative — fall back to the doc's stored values
  // (possibly stale) rather than failing the whole list.
  const valid = results
    .map((r) => r.restaurant)
    .filter((r): r is Restaurant => r !== null);
  let statsMap = new Map<string, { count: number; average: number }>();
  if (valid.length > 0) {
    try {
      statsMap = await getReviewStatsForRestaurants(valid.map((r) => r.id));
    } catch (err) {
      captureError(err, {
        screen: "saved",
        op: "fetchSaved.getReviewStatsForRestaurants",
        listType: type,
      });
    }
  }

  return results.map((r) => ({
    savedId: r.saved.id,
    savedAt: r.saved.createdAt,
    restaurant: r.restaurant
      ? (() => {
          const stats = statsMap.get(r.restaurant.id);
          return stats
            ? {
                ...r.restaurant,
                averageRating: stats.average,
                reviewCount: stats.count,
              }
            : r.restaurant;
        })()
      : null,
  }));
}

export function useSavedRestaurants(type: ListType) {
  return useQuery({
    queryKey: ["saved", type],
    queryFn: () => fetchSaved(type),
  });
}
