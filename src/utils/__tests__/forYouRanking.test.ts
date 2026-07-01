import type { Parish } from "@/types/restaurant";
import { rankForYou, type RankingContext } from "@/utils/forYouRanking";

import { makeRestaurant, makeReview } from "./fixtures";

const NOW = new Date("2024-06-01T12:00:00.000Z").getTime();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function ctx(overrides: Partial<RankingContext> = {}): RankingContext {
  return {
    followedAuthorIds: new Set(),
    savedRestaurantIds: new Set(),
    userParish: null,
    now: NOW,
    ...overrides,
  };
}

describe("rankForYou signals", () => {
  it("gives full recency to a fresh review and ~0 to a 7-day-old one", () => {
    const fresh = makeReview({ id: "f", createdAt: new Date(NOW).toISOString() });
    const old = makeReview({
      id: "o",
      createdAt: new Date(NOW - WEEK_MS).toISOString(),
    });
    const ranked = rankForYou(
      [
        { review: fresh, restaurant: null },
        { review: old, restaurant: null },
      ],
      ctx(),
    );
    const f = ranked.find((r) => r.review.id === "f")!;
    const o = ranked.find((r) => r.review.id === "o")!;
    expect(f.signals.recency).toBeCloseTo(10, 5);
    expect(o.signals.recency).toBeCloseTo(0, 5);
  });

  it("adds the followed-author bonus", () => {
    const review = makeReview({ userId: "u9" });
    const [item] = rankForYou(
      [{ review, restaurant: null }],
      ctx({ followedAuthorIds: new Set(["u9"]) }),
    );
    expect(item.signals.followedAuthor).toBe(8);
  });

  it("adds the saved-restaurant bonus", () => {
    const review = makeReview({ restaurantId: "rX" });
    const [item] = rankForYou(
      [{ review, restaurant: null }],
      ctx({ savedRestaurantIds: new Set(["rX"]) }),
    );
    expect(item.signals.savedRestaurant).toBe(6);
  });

  it("adds same-parish points only when the parishes match", () => {
    const review = makeReview();
    const r = makeRestaurant({ parish: "st_ann" });
    const match = rankForYou(
      [{ review, restaurant: r }],
      ctx({ userParish: "st_ann" }),
    )[0];
    const noMatch = rankForYou(
      [{ review, restaurant: r }],
      ctx({ userParish: "kingston" }),
    )[0];
    expect(match.signals.sameParish).toBe(5);
    expect(noMatch.signals.sameParish).toBe(0);
  });

  it("caps like points so one viral review can't dominate", () => {
    const review = makeReview({ likeCount: 1000 });
    const [item] = rankForYou([{ review, restaurant: null }], ctx());
    // LIKES_CAP (20) * LIKES_MULTIPLIER (0.5) = 10
    expect(item.signals.likes).toBe(10);
  });

  it("adds favorite-cuisine points on a cuisine OR category match", () => {
    const review = makeReview();
    const byCuisine = makeRestaurant({ cuisines: ["Jamaican"] });
    const byCategory = makeRestaurant({ categories: ["Jerk"] });
    const fav = new Set(["jamaican", "jerk"]);
    expect(
      rankForYou(
        [{ review, restaurant: byCuisine }],
        ctx({ favoriteCuisines: fav }),
      )[0].signals.favoriteCuisine,
    ).toBe(4);
    expect(
      rankForYou(
        [{ review, restaurant: byCategory }],
        ctx({ favoriteCuisines: fav }),
      )[0].signals.favoriteCuisine,
    ).toBe(4);
    // No favorites configured → no points
    expect(
      rankForYou([{ review, restaurant: byCuisine }], ctx())[0].signals
        .favoriteCuisine,
    ).toBe(0);
  });

  it("adds favorite-parish points only on a match", () => {
    const review = makeReview();
    const r = makeRestaurant({ parish: "st_ann" });
    expect(
      rankForYou(
        [{ review, restaurant: r }],
        ctx({ favoriteParishes: new Set<Parish>(["st_ann"]) }),
      )[0].signals.favoriteParish,
    ).toBe(3);
    expect(
      rankForYou(
        [{ review, restaurant: r }],
        ctx({ favoriteParishes: new Set<Parish>(["kingston"]) }),
      )[0].signals.favoriteParish,
    ).toBe(0);
  });
});

describe("rankForYou ordering", () => {
  it("ranks a higher-scoring review first (gap far exceeds the jitter)", () => {
    // Followed + fresh (~18 pts) vs plain + stale (~0 pts); jitter is ≤1.
    const strong = makeReview({
      id: "hi",
      userId: "u9",
      createdAt: new Date(NOW).toISOString(),
    });
    const weak = makeReview({
      id: "lo",
      userId: "u0",
      createdAt: new Date(NOW - WEEK_MS).toISOString(),
      likeCount: 0,
    });
    const ranked = rankForYou(
      [
        { review: weak, restaurant: null },
        { review: strong, restaurant: null },
      ],
      ctx({ followedAuthorIds: new Set(["u9"]) }),
    );
    expect(ranked[0].review.id).toBe("hi");
    expect(ranked).toHaveLength(2);
  });

  it("keeps items whose restaurant is null (still ranks on review signals)", () => {
    const review = makeReview();
    const ranked = rankForYou([{ review, restaurant: null }], ctx());
    expect(ranked).toHaveLength(1);
    expect(ranked[0].signals.quality).toBe(0);
    expect(ranked[0].signals.sameParish).toBe(0);
  });
});
