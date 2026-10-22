import { addCollectionSelections, loadCollectionSuggestions, searchCollectionRestaurants } from "@/services/collectionPicker";
import { addToList, getList } from "@/services/lists";
import { listRestaurants } from "@/services/restaurants";
import { listReviewsByUser } from "@/services/reviews";
import { listSavedByUser } from "@/services/saved";
import { getTastePreferences } from "@/services/userPreferences";
import { recordSupabaseSession } from "@/services/supabaseSessionFence";
import { makeRestaurant, makeReview } from "@/utils/__tests__/fixtures";

jest.mock("@/services/lists", () => ({ addToList: jest.fn(), getList: jest.fn() }));
jest.mock("@/services/restaurants", () => ({ listRestaurants: jest.fn() }));
jest.mock("@/services/reviews", () => ({ listReviewsByUser: jest.fn() }));
jest.mock("@/services/saved", () => ({ listSavedByUser: jest.fn() }));
jest.mock("@/services/userPreferences", () => ({ getTastePreferences: jest.fn() }));
const restaurants = listRestaurants as jest.Mock, reviews = listReviewsByUser as jest.Mock;
const saves = listSavedByUser as jest.Mock, taste = getTastePreferences as jest.Mock;
const collection = getList as jest.Mock, add = addToList as jest.Mock;
beforeEach(() => {
  jest.resetAllMocks(); recordSupabaseSession({ user: { id: "owner" }, access_token: "fixture" });
  restaurants.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  reviews.mockResolvedValue({ items: [], hasMore: false }); saves.mockResolvedValue([]);
  taste.mockResolvedValue({ favoriteCuisines: [], favoriteParishes: [] });
  collection.mockResolvedValue({ ownerId: "owner", restaurantIds: [] }); add.mockResolvedValue({});
});
test("suggestions page through the catalogue and review history, not just the first window", async () => {
  restaurants.mockResolvedValueOnce({ items: [makeRestaurant({ id: "discovery" })], hasMore: true, nextCursor: "next" })
    .mockResolvedValueOnce({ items: [makeRestaurant({ id: "reviewed" })], hasMore: false });
  reviews.mockResolvedValueOnce({ items: [], hasMore: true, nextCursor: "review-next" })
    .mockResolvedValueOnce({ items: [makeReview({ restaurantId: "reviewed" })], hasMore: false });
  const result = await loadCollectionSuggestions("owner", [], null);
  expect(result.items[0].restaurant.id).toBe("reviewed");
  expect(restaurants.mock.calls[1][0].cursor).toBe("next"); expect(reviews.mock.calls[1][1].cursor).toBe("review-next");
});
test("personalization failures degrade to discovery, catalogue failures remain retryable", async () => {
  saves.mockRejectedValue(new Error("offline")); taste.mockRejectedValue(new Error("offline"));
  restaurants.mockResolvedValue({ items: [makeRestaurant()], hasMore: false });
  expect(await loadCollectionSuggestions("owner", [], null)).toMatchObject({ limitedPersonalization: true, items: [{ restaurant: { id: "r1" } }] });
  restaurants.mockRejectedValue(new Error("Catalogue offline")); await expect(loadCollectionSuggestions("owner", [], null)).rejects.toThrow("Catalogue offline");
});
test("repeated catalogue cursors fail rather than looping forever", async () => {
  restaurants.mockResolvedValue({ items: [], hasMore: true, nextCursor: "same" });
  await expect(loadCollectionSuggestions("owner", [], null)).rejects.toThrow("retry");
});
test("search queries the server, fills a 20-result page excluding current membership and retains its cursor", async () => {
  restaurants.mockResolvedValueOnce({ items: [makeRestaurant({ id: "already" }), ...Array.from({ length: 19 }, (_, i) => makeRestaurant({ id: `search-${i}` }))], hasMore: true, nextCursor: "next" })
    .mockResolvedValueOnce({ items: [makeRestaurant({ id: "last" })], hasMore: true, nextCursor: "next-2" });
  const result = await searchCollectionRestaurants(" Jamaican ", ["already"]);
  expect(result.items).toHaveLength(20); expect(result.nextCursor).toBe("next-2"); expect(result.hasMore).toBe(true);
  expect(restaurants.mock.calls[0][0]).toMatchObject({ filters: { search: "Jamaican" }, pageSize: 20 });
  expect(restaurants.mock.calls[1][0]).toMatchObject({ pageSize: 1, cursor: "next" });
});
test("load more starts at the search cursor and detects a stalled page", async () => {
  await searchCollectionRestaurants("pizza", [], "after"); expect(restaurants).toHaveBeenCalledWith(expect.objectContaining({ cursor: "after" }));
  restaurants.mockResolvedValue({ items: [], hasMore: true, nextCursor: "after" });
  await expect(searchCollectionRestaurants("pizza", [], "after")).rejects.toThrow("retry");
});
test("bulk selection deduplicates and performs sequential adds while reporting partial failures", async () => {
  collection.mockResolvedValue({ ownerId: "owner", restaurantIds: ["existing"] });
  add.mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce({});
  expect(await addCollectionSelections("list", "owner", ["existing", "fail", "success", "success"])).toEqual({ addedIds: ["existing", "success"], failedIds: ["fail"] });
  expect(add.mock.calls).toEqual([["list", "fail"], ["list", "success"]]);
});
test("non-owners cannot add anything", async () => {
  collection.mockResolvedValue({ ownerId: "other", restaurantIds: [] });
  await expect(addCollectionSelections("list", "owner", ["r1"])).rejects.toThrow("Only the collection owner"); expect(add).not.toHaveBeenCalled();
});
test("session changes abort queued writes and discard late recommendation results", async () => {
  add.mockImplementationOnce(async () => { recordSupabaseSession(null); return {}; });
  await expect(addCollectionSelections("list", "owner", ["r1", "r2"])).rejects.toThrow("session changed"); expect(add).toHaveBeenCalledTimes(1);
  recordSupabaseSession({ user: { id: "owner" }, access_token: "fixture-2" });
  taste.mockImplementationOnce(async () => { recordSupabaseSession(null); return { favoriteCuisines: [], favoriteParishes: [] }; });
  await expect(loadCollectionSuggestions("owner", [], null)).rejects.toThrow("session changed");
});
