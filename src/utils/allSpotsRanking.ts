// src/utils/allSpotsRanking.ts
// Personalized ordering for the "All Spots" list. Instead of plain recency it
// blends the three things the user actually cares about:
//   - Taste:    cuisines/parishes they picked at signup (onboarding favorites)
//   - Location: closer spots rank higher (when location is available)
//   - Random:   a seeded shuffle so the list feels fresh and isn't deterministic
// A restaurant's rating adds a small tiebreaker lift. Pure function — the screen
// passes a per-session `seed` so the order stays stable across pagination but
// reshuffles on pull-to-refresh.

import type { Parish, Restaurant } from "@/types/restaurant";
import { getDistanceKm } from "@/utils/distance";

// A single per-app-session shuffle seed. Shared by the home "All Spots" preview
// and the "See all" page so both render the SAME personalized order. Computed
// once at module load; stable until the JS reloads.
export const ALL_SPOTS_SEED = Math.floor(Math.random() * 1_000_000_000);

// Max points each signal can contribute. Tune to rebalance.
const WEIGHTS = {
  FAVORITE_CUISINE: 5,
  FAVORITE_PARISH: 3,
  PROXIMITY_MAX: 6, // closest spots get the full points
  QUALITY_MULTIPLIER: 0.5, // ~0–2.5 pts from averageRating
  RANDOM_JITTER: 4, // enough to meaningfully mix the order
} as const;

// Proximity: full points within FULL_KM, fading linearly to 0 at ZERO_KM.
const PROXIMITY_FULL_KM = 2;
const PROXIMITY_ZERO_KM = 30;

export interface AllSpotsContext {
  /** Lowercased cuisines the user favorited at onboarding. */
  favoriteCuisines: Set<string>;
  /** Parishes the user favorited at onboarding. */
  favoriteParishes: Set<Parish>;
  /** User location, or null when unavailable/denied. */
  userLocation: { latitude: number; longitude: number } | null;
  /** Stable per-session seed for the deterministic shuffle. */
  seed: number;
}

// Deterministic [0,1) hash from a restaurant id + the session seed. Stable for a
// given (id, seed) so the shuffle doesn't churn between renders (which would
// jump the pagination around).
function seededUnit(id: string, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
}

function scoreRestaurant(r: Restaurant, ctx: AllSpotsContext): number {
  let score = 0;

  if (
    ctx.favoriteCuisines.size > 0 &&
    [...r.cuisines, ...r.categories].some((c) =>
      ctx.favoriteCuisines.has(c.toLowerCase()),
    )
  ) {
    score += WEIGHTS.FAVORITE_CUISINE;
  }

  if (ctx.favoriteParishes.has(r.parish)) {
    score += WEIGHTS.FAVORITE_PARISH;
  }

  if (ctx.userLocation) {
    const d = getDistanceKm(
      ctx.userLocation.latitude,
      ctx.userLocation.longitude,
      r.latitude,
      r.longitude,
    );
    const frac = Math.max(
      0,
      Math.min(
        1,
        (PROXIMITY_ZERO_KM - d) / (PROXIMITY_ZERO_KM - PROXIMITY_FULL_KM),
      ),
    );
    score += frac * WEIGHTS.PROXIMITY_MAX;
  }

  score += r.averageRating * WEIGHTS.QUALITY_MULTIPLIER;
  score += seededUnit(r.id, ctx.seed) * WEIGHTS.RANDOM_JITTER;

  return score;
}

/** Returns a NEW array sorted best-first by the blended score. */
export function rankAllSpots(
  restaurants: Restaurant[],
  ctx: AllSpotsContext,
): Restaurant[] {
  return restaurants
    .map((r) => ({ r, s: scoreRestaurant(r, ctx) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}
