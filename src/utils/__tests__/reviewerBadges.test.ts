import { getReviewerBadges } from "@/utils/reviewerBadges";

const ids = (stats: { reviewCount: number; parishesVisited: number }) =>
  getReviewerBadges(stats).map((b) => b.id);

describe("getReviewerBadges", () => {
  it("returns nothing with no activity", () => {
    expect(getReviewerBadges({ reviewCount: 0, parishesVisited: 0 })).toEqual([]);
  });

  it("recognizes a first review", () => {
    expect(ids({ reviewCount: 1, parishesVisited: 0 })).toEqual(["reviewer"]);
  });

  it("climbs the volume tiers", () => {
    expect(ids({ reviewCount: 10, parishesVisited: 0 })).toEqual(["top-reviewer"]);
    expect(ids({ reviewCount: 25, parishesVisited: 0 })).toEqual(["local-expert"]);
  });

  it("adds a parish-coverage badge alongside the volume badge", () => {
    expect(ids({ reviewCount: 30, parishesVisited: 8 })).toEqual([
      "local-expert",
      "island-explorer",
    ]);
    expect(ids({ reviewCount: 5, parishesVisited: 14 })).toEqual([
      "reviewer",
      "island-master",
    ]);
  });

  it("requires 3+ parishes for the explorer badge", () => {
    expect(ids({ reviewCount: 5, parishesVisited: 2 })).toEqual(["reviewer"]);
    expect(ids({ reviewCount: 5, parishesVisited: 3 })).toEqual([
      "reviewer",
      "parish-explorer",
    ]);
  });
});
