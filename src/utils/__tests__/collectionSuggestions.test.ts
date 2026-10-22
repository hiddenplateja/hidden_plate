import { COLLECTION_PICKER_PAGE_SIZE, rankCollectionSuggestions, type CollectionSignals } from "@/utils/collectionSuggestions";
import { makeRestaurant } from "./fixtures";

const signals = (patch: Partial<CollectionSignals> = {}): CollectionSignals => ({
  favorites: new Set(), visited: new Set(), saved: new Set(), reviewed: new Set(),
  favoriteCuisines: [], favoriteParishes: [], location: null, ...patch,
});
test("favorites, visits and reviews precede discovery without duplicating restaurants", () => {
  const restaurants = ["popular", "reviewed", "visited", "favorite"].map(id => makeRestaurant({ id, name: id, averageRating: 5, reviewCount: 20 }));
  const ranked = rankCollectionSuggestions([...restaurants, restaurants[0]], [], signals({
    favorites: new Set(["favorite"]), visited: new Set(["visited"]), reviewed: new Set(["reviewed"]),
  }));
  expect(ranked.map(item => item.restaurant.id)).toEqual(["favorite", "visited", "reviewed", "popular"]);
  expect(ranked[0].reason).toBe("In your favorites");
});
test("existing and inactive listings are excluded", () => {
  expect(rankCollectionSuggestions([makeRestaurant({ id: "existing" }), makeRestaurant({ id: "inactive", isActive: false }), makeRestaurant({ id: "eligible" })], ["existing"], signals()).map(item => item.restaurant.id)).toEqual(["eligible"]);
});
test("explicit and inferred cuisine interests influence discovery", () => {
  const restaurants = [makeRestaurant({ id: "favorite", cuisines: ["Jamaican"] }), makeRestaurant({ id: "similar", categories: ["jamaican"] }), makeRestaurant({ id: "explicit", cuisines: ["Indian"] }), makeRestaurant({ id: "other" })];
  const ranked = rankCollectionSuggestions(restaurants, ["favorite"], signals({ favorites: new Set(["favorite"]), favoriteCuisines: ["INDIAN"] }));
  expect(ranked.slice(0, 2).map(item => item.restaurant.id).sort()).toEqual(["explicit", "similar"]);
});
test("nearby and preferred-parish restaurants get a boost without requiring location", () => {
  const restaurants = [makeRestaurant({ id: "far", latitude: 20 }), makeRestaurant({ id: "near", latitude: 18, parish: "st_ann" })];
  expect(rankCollectionSuggestions(restaurants, [], signals({ location: { latitude: 18, longitude: -76.8 } }))[0]).toMatchObject({ restaurant: { id: "near" }, reason: "Near you" });
  expect(rankCollectionSuggestions(restaurants, [], signals({ favoriteParishes: ["st_ann"] }))[0].restaurant.id).toBe("near");
  expect(rankCollectionSuggestions(restaurants, [], signals())).toHaveLength(2);
});
test("cold starts have deterministic ordering and pages initially contain 20 results", () => {
  const restaurants = Array.from({ length: 45 }, (_, i) => makeRestaurant({ id: String(i).padStart(2, "0"), name: "Same" }));
  const ranked = rankCollectionSuggestions(restaurants.reverse(), [], signals());
  expect(ranked.slice(0, COLLECTION_PICKER_PAGE_SIZE)).toHaveLength(20);
  expect(ranked[0].restaurant.id).toBe("00");
  expect(restaurants[0].id).toBe("44");
});
