import {
  addRestaurantId,
  removeRestaurantId,
  resolveCoverId,
} from "@/utils/listEditing";

describe("listEditing", () => {
  it("adds without duplicating", () => {
    expect(addRestaurantId(["a"], "b")).toEqual(["a", "b"]);
    expect(addRestaurantId(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("removes (no-op when absent)", () => {
    expect(removeRestaurantId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(removeRestaurantId(["a"], "x")).toEqual(["a"]);
  });

  it("resolves cover: keep current, else first, else null", () => {
    expect(resolveCoverId(["a", "b"], "b")).toBe("b");
    expect(resolveCoverId(["a", "b"], "x")).toBe("a"); // current dropped → first
    expect(resolveCoverId(["a", "b"], null)).toBe("a");
    expect(resolveCoverId([], "a")).toBeNull();
  });
});
