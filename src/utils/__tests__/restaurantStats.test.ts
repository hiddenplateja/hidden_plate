import { mergeReviewStats, type ReviewStats } from "@/utils/restaurantStats";

import { makeRestaurant } from "./fixtures";

describe("mergeReviewStats", () => {
  it("overlays live stats onto the matching restaurant by id", () => {
    const list = [
      makeRestaurant({ id: "a", averageRating: 1, reviewCount: 1 }),
      makeRestaurant({ id: "b", averageRating: 2, reviewCount: 2 }),
    ];
    const stats = new Map<string, ReviewStats>([["a", { average: 4.5, count: 10 }]]);

    const out = mergeReviewStats(list, stats);

    expect(out[0].averageRating).toBe(4.5);
    expect(out[0].reviewCount).toBe(10);
    // "b" has no live stats → untouched.
    expect(out[1].averageRating).toBe(2);
    expect(out[1].reviewCount).toBe(2);
  });

  it("passes restaurants through unchanged when there are no stats", () => {
    const list = [makeRestaurant({ id: "a", averageRating: 3, reviewCount: 7 })];
    expect(mergeReviewStats(list, new Map())).toEqual(list);
  });

  it("does not mutate the input restaurants", () => {
    const r = makeRestaurant({ id: "a", averageRating: 1, reviewCount: 1 });
    const stats = new Map<string, ReviewStats>([["a", { average: 5, count: 9 }]]);

    mergeReviewStats([r], stats);

    expect(r.averageRating).toBe(1);
    expect(r.reviewCount).toBe(1);
  });

  it("returns a new array when it merges", () => {
    const list = [makeRestaurant({ id: "a" })];
    const stats = new Map<string, ReviewStats>([["a", { average: 5, count: 1 }]]);
    expect(mergeReviewStats(list, stats)).not.toBe(list);
  });
});
