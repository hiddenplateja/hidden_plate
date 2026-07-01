import {
  pickSpotOfTheDay,
  scoreRestaurant,
  seededIndex,
  spotDayKey,
} from "@/utils/spotOfTheDay";

import { makeRestaurant } from "./fixtures";

describe("spotDayKey", () => {
  it("formats YYYY-MM-DD with zero-padding", () => {
    // Local date: Jan 5, 2024 (month is 0-indexed in the Date constructor).
    expect(spotDayKey(new Date(2024, 0, 5))).toBe("2024-01-05");
    expect(spotDayKey(new Date(2024, 11, 31))).toBe("2024-12-31");
  });
});

describe("seededIndex", () => {
  it("is deterministic for the same seed + length", () => {
    expect(seededIndex("2024-06-01", 10)).toBe(seededIndex("2024-06-01", 10));
  });

  it("stays within [0, length)", () => {
    for (const seed of ["a", "b", "xyz", "2024-12-31"]) {
      const i = seededIndex(seed, 7);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });

  it("returns 0 for a non-positive length", () => {
    expect(seededIndex("a", 0)).toBe(0);
  });

  it("varies across seeds (not all the same index)", () => {
    const indices = new Set(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((s) =>
        seededIndex(s, 15),
      ),
    );
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe("scoreRestaurant", () => {
  it("rewards rating, reviews, featured and verified", () => {
    const plain = makeRestaurant({ averageRating: 4, reviewCount: 0 });
    const better = makeRestaurant({
      averageRating: 4,
      reviewCount: 100,
      isFeatured: true,
      isVerified: true,
    });
    expect(scoreRestaurant(better)).toBeGreaterThan(scoreRestaurant(plain));
  });
});

describe("pickSpotOfTheDay", () => {
  it("returns null for an empty pool", () => {
    expect(pickSpotOfTheDay([])).toBeNull();
  });

  it("is stable for a given day key", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      makeRestaurant({ id: `r${i}`, averageRating: 4.5, reviewCount: 10 }),
    );
    expect(pickSpotOfTheDay(pool, "2024-06-01")?.id).toBe(
      pickSpotOfTheDay(pool, "2024-06-01")?.id,
    );
  });

  it("only picks quality-gated spots when some qualify", () => {
    const good = makeRestaurant({ id: "good", averageRating: 4.8, reviewCount: 50 });
    const weak = makeRestaurant({ id: "weak", averageRating: 2.0, reviewCount: 1 });
    expect(pickSpotOfTheDay([good, weak], "any-day")?.id).toBe("good");
  });

  it("falls back to the whole pool when nothing clears the bar", () => {
    const weak1 = makeRestaurant({ id: "w1", averageRating: 2, reviewCount: 1 });
    const weak2 = makeRestaurant({ id: "w2", averageRating: 1, reviewCount: 0 });
    const pick = pickSpotOfTheDay([weak1, weak2], "any-day");
    expect(pick).not.toBeNull();
    expect(["w1", "w2"]).toContain(pick?.id);
  });

  it("ignores inactive spots when active ones exist", () => {
    const active = makeRestaurant({
      id: "active",
      isActive: true,
      averageRating: 4.5,
      reviewCount: 10,
    });
    const inactive = makeRestaurant({
      id: "inactive",
      isActive: false,
      averageRating: 5,
      reviewCount: 100,
    });
    expect(pickSpotOfTheDay([inactive, active], "d")?.id).toBe("active");
  });
});
