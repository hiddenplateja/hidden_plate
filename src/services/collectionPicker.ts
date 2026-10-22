import { addToList, getList } from "@/services/lists";
import { listRestaurants } from "@/services/restaurants";
import { listReviewsByUser } from "@/services/reviews";
import { listSavedByUser } from "@/services/saved";
import { getTastePreferences } from "@/services/userPreferences";
import { assertSupabaseSessionRevision, captureSupabaseSessionRevision } from "@/services/supabaseSessionFence";
import type { Restaurant } from "@/types/restaurant";
import { COLLECTION_PICKER_PAGE_SIZE, rankCollectionSuggestions } from "@/utils/collectionSuggestions";

async function catalogue() {
  const restaurants: Restaurant[] = [], seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await listRestaurants({ sort: "name", pageSize: 100, cursor });
    restaurants.push(...page.items);
    if (!page.hasMore) break;
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error("Couldn't finish loading restaurants. Please retry.");
    seen.add(page.nextCursor); cursor = page.nextCursor;
  } while (cursor);
  return restaurants;
}
async function reviewedRestaurantIds(userId: string) {
  const ids = new Set<string>(), seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await listReviewsByUser(userId, { pageSize: 100, cursor });
    page.items.forEach(review => ids.add(review.restaurantId));
    if (!page.hasMore) break;
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error("Couldn't load review history.");
    seen.add(page.nextCursor); cursor = page.nextCursor;
  } while (cursor);
  return ids;
}
export async function loadCollectionSuggestions(userId: string, existingIds: string[], location: { latitude: number; longitude: number } | null) {
  const revision = captureSupabaseSessionRevision();
  let limitedPersonalization = false;
  const optional = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => { limitedPersonalization = true; return fallback; });
  const [restaurants, saved, reviewed, taste] = await Promise.all([
    catalogue(), optional(listSavedByUser(undefined, 2000), []),
    optional(reviewedRestaurantIds(userId), new Set<string>()),
    optional(getTastePreferences(), { favoriteCuisines: [], favoriteParishes: [] }),
  ]);
  assertSupabaseSessionRevision(revision);
  return { limitedPersonalization, items: rankCollectionSuggestions(restaurants, existingIds, {
    favorites: new Set(saved.filter(row => row.listType === "favorite").map(row => row.restaurantId)),
    visited: new Set(saved.filter(row => row.listType === "visited").map(row => row.restaurantId)),
    saved: new Set(saved.map(row => row.restaurantId)), reviewed,
    ...taste, location,
  }) };
}

/** Server-side search with cursor paging; never limited to suggestion candidates. */
export async function searchCollectionRestaurants(term: string, existingIds: string[], after: string | null = null) {
  const revision = captureSupabaseSessionRevision();
  const excluded = new Set(existingIds), seen = new Set<string>();
  const items: Restaurant[] = [];
  let cursor = after, hasMore = true;
  while (hasMore && items.length < COLLECTION_PICKER_PAGE_SIZE) {
    const page = await listRestaurants({ filters: { search: term.trim() }, sort: "name",
      pageSize: COLLECTION_PICKER_PAGE_SIZE - items.length, cursor });
    for (const item of page.items) if (item.isActive && !excluded.has(item.id)) { items.push(item); excluded.add(item.id); }
    hasMore = page.hasMore; cursor = page.nextCursor;
    if (hasMore && (!cursor || cursor === after || seen.has(cursor))) throw new Error("Couldn't load more results. Please retry.");
    if (cursor) seen.add(cursor);
  }
  assertSupabaseSessionRevision(revision);
  return { items, hasMore, nextCursor: cursor };
}

/** Sequential writes also protect the legacy read/modify/write implementation.
 * Successful writes are retained on partial failure; only failures need retry. */
export async function addCollectionSelections(collectionId: string, ownerId: string, selectedIds: string[]) {
  const revision = captureSupabaseSessionRevision();
  const list = await getList(collectionId);
  assertSupabaseSessionRevision(revision);
  if (list.ownerId !== ownerId) throw new Error("Only the collection owner can add restaurants.");
  const existing = new Set(list.restaurantIds), addedIds: string[] = [], failedIds: string[] = [];
  for (const id of new Set(selectedIds)) {
    assertSupabaseSessionRevision(revision);
    if (existing.has(id)) { addedIds.push(id); continue; }
    try { await addToList(collectionId, id); addedIds.push(id); }
    catch { failedIds.push(id); }
    assertSupabaseSessionRevision(revision);
  }
  return { addedIds, failedIds };
}
