import type { Restaurant, Parish } from "@/types/restaurant";
import { getDistanceKm } from "@/utils/distance";

export const COLLECTION_PICKER_PAGE_SIZE = 20;
export interface CollectionSignals {
  favorites: Set<string>;
  visited: Set<string>;
  saved: Set<string>;
  reviewed: Set<string>;
  favoriteCuisines: string[];
  favoriteParishes: Parish[];
  location: { latitude: number; longitude: number } | null;
}

/** Stable, private, on-device ranking. Explicit activity outweighs discovery. */
export function rankCollectionSuggestions(restaurants: Restaurant[], existingIds: string[], signals: CollectionSignals) {
  const existing = new Set(existingIds);
  const interests = new Set(signals.favoriteCuisines.map(value => value.toLowerCase()));
  const parishes = new Set(signals.favoriteParishes);
  const byId = new Map(restaurants.filter(r => r.isActive).map(r => [r.id, r]));
  // Infer interests from places the user chose, in addition to onboarding picks.
  for (const restaurant of byId.values()) {
    if (signals.favorites.has(restaurant.id) || signals.visited.has(restaurant.id) || signals.reviewed.has(restaurant.id)) {
      for (const tag of [...restaurant.cuisines, ...restaurant.categories]) interests.add(tag.toLowerCase());
    }
  }
  return [...byId.values()].filter(r => !existing.has(r.id)).map(restaurant => {
    const tags = [...restaurant.cuisines, ...restaurant.categories];
    const matchesInterest = tags.some(tag => interests.has(tag.toLowerCase()));
    const distance = signals.location && Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude)
      ? getDistanceKm(signals.location.latitude, signals.location.longitude, restaurant.latitude, restaurant.longitude) : null;
    const nearby = distance !== null ? Math.max(0, 12 * (1 - distance / 50)) : 0;
    const score = (signals.favorites.has(restaurant.id) ? 100 : 0)
      + (signals.visited.has(restaurant.id) ? 60 : 0)
      + (signals.reviewed.has(restaurant.id) ? 50 : 0)
      + (signals.saved.has(restaurant.id) ? 30 : 0)
      + (matchesInterest ? 15 : 0) + (parishes.has(restaurant.parish) ? 8 : 0)
      + nearby + (restaurant.reviewCount > 0 ? Math.min(5, restaurant.averageRating) : 0);
    const reason = signals.favorites.has(restaurant.id) ? "In your favorites"
      : signals.visited.has(restaurant.id) ? "You've visited"
      : signals.reviewed.has(restaurant.id) ? "You've reviewed"
      : signals.saved.has(restaurant.id) ? "On your want-to-go list"
      : distance !== null && distance < 50 ? "Near you"
      : matchesInterest ? "Matches your interests"
      : parishes.has(restaurant.parish) ? "In a favorite parish" : "Discover a spot";
    return { restaurant, reason, score };
  }).sort((a, b) => b.score - a.score || a.restaurant.name.localeCompare(b.restaurant.name) || a.restaurant.id.localeCompare(b.restaurant.id));
}
