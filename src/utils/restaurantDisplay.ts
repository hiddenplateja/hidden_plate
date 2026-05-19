// src/utils/restaurantDisplay.ts
// Shared display helpers for restaurant cards.
// Keeps the format consistent everywhere.

import type { Parish, Restaurant } from "@/types/restaurant";

const PARISH_LABELS: Record<Parish, string> = {
  kingston: "Kingston",
  st_andrew: "St. Andrew",
  st_thomas: "St. Thomas",
  portland: "Portland",
  st_mary: "St. Mary",
  st_ann: "St. Ann",
  trelawny: "Trelawny",
  st_james: "St. James",
  hanover: "Hanover",
  westmoreland: "Westmoreland",
  st_elizabeth: "St. Elizabeth",
  manchester: "Manchester",
  clarendon: "Clarendon",
  st_catherine: "St. Catherine",
};

/**
 * Build the cuisine line for a restaurant card.
 *
 * Format: "<first cuisine> • <up to 2 categories>"
 * Examples:
 *   - 1 cuisine + 2 categories → "Jamaican • Jerk • BBQ"
 *   - 1 cuisine + 1 category   → "Jamaican • Jerk"
 *   - 1 cuisine + 0 categories → "Jamaican"
 *   - 0 cuisines + 2 categories → "Jerk • BBQ"
 *   - 0 cuisines + 0 categories → null
 *
 * Returns null if there's nothing to display — callers should skip the row.
 */
export function getCuisineLine(restaurant: Restaurant): string | null {
  const parts: string[] = [];
  if (restaurant.cuisines.length > 0) {
    parts.push(restaurant.cuisines[0]);
  }
  parts.push(...restaurant.categories.slice(0, 2));
  if (parts.length === 0) return null;
  return parts.join(" • ");
}

/**
 * Build the location line for a restaurant card.
 *
 * Prefers city ("Montego Bay") which is more useful than parish.
 * Falls back to parish ("St. James") when city isn't set.
 * Returns null only if both are missing (shouldn't happen — parish is required).
 */
export function getLocationLine(restaurant: Restaurant): string | null {
  if (restaurant.city && restaurant.city.trim()) {
    return restaurant.city.trim();
  }
  if (restaurant.parish) {
    return PARISH_LABELS[restaurant.parish] ?? restaurant.parish;
  }
  return null;
}
