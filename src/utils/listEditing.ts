// src/utils/listEditing.ts
// Pure helpers for editing a collection's `restaurantIds` array. SDK-free so
// they're trivially unit-testable; the lists service applies them around a
// read-modify-write of the list document.

/** Append an id unless it's already present (preserves order). */
export function addRestaurantId(ids: string[], restaurantId: string): string[] {
  return ids.includes(restaurantId) ? ids : [...ids, restaurantId];
}

/** Remove an id (no-op when absent). */
export function removeRestaurantId(
  ids: string[],
  restaurantId: string,
): string[] {
  return ids.filter((id) => id !== restaurantId);
}

/**
 * Keep the cover valid after an edit: retain the current cover if it's still
 * in the list, otherwise fall back to the first item (or null when empty).
 */
export function resolveCoverId(
  ids: string[],
  current: string | null,
): string | null {
  if (current && ids.includes(current)) return current;
  return ids[0] ?? null;
}
