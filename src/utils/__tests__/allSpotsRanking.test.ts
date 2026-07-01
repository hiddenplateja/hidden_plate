import { rankAllSpots, type AllSpotsContext } from "@/utils/allSpotsRanking";

import { makeRestaurant } from "./fixtures";

const ctx = (over: Partial<AllSpotsContext> = {}): AllSpotsContext => ({
  favoriteCuisines: new Set(),
  favoriteParishes: new Set(),
  userLocation: null,
  seed: 1,
  ...over,
});

describe("rankAllSpots", () => {
  // FAVORITE_CUISINE (5) > RANDOM_JITTER max (4), so a match always wins when
  // the other signals are equal — regardless of the shuffle seed.
  it("ranks a favorite-cuisine match ahead of a non-match for any seed", () => {
    const match = makeRestaurant({ id: "a", cuisines: ["jerk"] });
    const other = makeRestaurant({ id: "b", cuisines: ["chinese"] });
    for (const seed of [1, 7, 42, 1000]) {
      const ranked = rankAllSpots(
        [other, match],
        ctx({ favoriteCuisines: new Set(["jerk"]), seed }),
      );
      expect(ranked[0].id).toBe("a");
    }
  });

  // PROXIMITY_MAX (6) > jitter (4), so the nearer spot always leads.
  it("ranks closer spots ahead of far ones when location is known", () => {
    const near = makeRestaurant({ id: "near", latitude: 18, longitude: -76.8 });
    const far = makeRestaurant({ id: "far", latitude: 18.5, longitude: -77.5 });
    for (const seed of [1, 7, 42]) {
      const ranked = rankAllSpots(
        [far, near],
        ctx({ userLocation: { latitude: 18, longitude: -76.8 }, seed }),
      );
      expect(ranked[0].id).toBe("near");
    }
  });

  it("is deterministic for a given seed and returns a new array", () => {
    const items = [
      makeRestaurant({ id: "a" }),
      makeRestaurant({ id: "b" }),
      makeRestaurant({ id: "c" }),
    ];
    const a = rankAllSpots(items, ctx({ seed: 99 }));
    const b = rankAllSpots(items, ctx({ seed: 99 }));
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(a).not.toBe(items);
  });

  it("varies the order across seeds (the shuffle actually shuffles)", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      makeRestaurant({ id: `r${i}` }),
    );
    const order = (seed: number) =>
      rankAllSpots(items, ctx({ seed }))
        .map((r) => r.id)
        .join(",");
    expect(order(1)).not.toBe(order(2));
  });
});
