// src/utils/spotOfTheDay.ts
// "Spot of the Day" selection logic (pure — no network).
//
// The automatic pick is a QUALITY-GATED DAILY ROTATION:
//   1. Keep only active, well-established spots (rating + review thresholds).
//   2. Rank them by a score of rating + reviews + featured/verified.
//   3. Rotate deterministically among the top N by the calendar day, so the
//      pick is stable for 24h and changes at local midnight.
//
// All the knobs live in SPOT_CONFIG below. The MANUAL override (a pinned
// restaurant from the Appwrite config doc) is applied in the service layer
// (services/spotOfTheDay.ts), not here.

import type { Restaurant } from "@/types/restaurant";

export const SPOT_CONFIG = {
  /** Minimum average rating to be eligible for the auto-pick. */
  minRating: 4.3,
  /** Minimum review count to be eligible (enough signal to be credible). */
  minReviews: 5,
  /** Rotate among this many top-scoring spots so it varies day to day. */
  topPoolSize: 15,
  /** Score weights — tune to taste. */
  weights: {
    rating: 1, // averageRating (0–5), the dominant factor
    reviews: 0.4, // log10(1 + reviewCount) — diminishing returns
    featured: 0.6, // bonus when isFeatured
    verified: 0.3, // bonus when isVerified
  },
};

/** Local calendar day key "YYYY-MM-DD" — the rotation seed (rolls at midnight). */
export function spotDayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Stable string hash (FNV-1a) → non-negative 32-bit int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic index in [0, length) from a string seed. */
export function seededIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  return hashString(seed) % length;
}

export function scoreRestaurant(r: Restaurant): number {
  const w = SPOT_CONFIG.weights;
  return (
    r.averageRating * w.rating +
    Math.log10(1 + Math.max(0, r.reviewCount)) * w.reviews +
    (r.isFeatured ? w.featured : 0) +
    (r.isVerified ? w.verified : 0)
  );
}

/**
 * Deterministic daily pick from a pool of restaurants. Returns null only when
 * the pool is empty. `dayKey` is injectable for testing.
 */
export function pickSpotOfTheDay(
  restaurants: Restaurant[],
  dayKey: string = spotDayKey(),
): Restaurant | null {
  const active = restaurants.filter((r) => r.isActive);
  const base = active.length > 0 ? active : restaurants;

  // Quality gate; fall back to the full base if nothing clears the bar.
  let pool = base.filter(
    (r) =>
      r.reviewCount >= SPOT_CONFIG.minReviews &&
      r.averageRating >= SPOT_CONFIG.minRating,
  );
  if (pool.length === 0) pool = base;
  if (pool.length === 0) return null;

  // Rank by score; tie-break by id so the sort is stable across renders.
  const ranked = [...pool].sort(
    (a, b) => scoreRestaurant(b) - scoreRestaurant(a) || (a.id < b.id ? -1 : 1),
  );
  const top = ranked.slice(0, Math.min(SPOT_CONFIG.topPoolSize, ranked.length));

  return top[seededIndex(dayKey, top.length)];
}
