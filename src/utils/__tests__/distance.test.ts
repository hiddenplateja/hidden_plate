import { getDistanceKm } from "@/utils/distance";

describe("getDistanceKm", () => {
  it("is zero for identical points", () => {
    expect(getDistanceKm(18, -76.8, 18, -76.8)).toBe(0);
  });

  it("is symmetric", () => {
    const a = getDistanceKm(18.0, -76.8, 18.5, -77.9);
    const b = getDistanceKm(18.5, -77.9, 18.0, -76.8);
    expect(a).toBeCloseTo(b, 9);
  });

  it("computes ~111 km for one degree of latitude", () => {
    expect(getDistanceKm(0, 0, 1, 0)).toBeCloseTo(111.19, 0);
  });

  it("matches the Kingston → Montego Bay distance (~140 km)", () => {
    // Kingston (17.9714, -76.7929) → Montego Bay (18.4762, -77.8939)
    const km = getDistanceKm(17.9714, -76.7929, 18.4762, -77.8939);
    expect(km).toBeGreaterThan(125);
    expect(km).toBeLessThan(155);
  });
});
