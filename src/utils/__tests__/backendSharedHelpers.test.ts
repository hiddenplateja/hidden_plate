import { validateBio, validateDisplayName, validateUsername } from "@/utils/profileValidation";
import { parseMenu, serializeMenu } from "@/utils/restaurantMenuCodec";
test.each([["", "Display name is required"], [" x ", "At least 2 characters"], ["x".repeat(51), "At most 50 characters"], [" Foodie ", null]])("display-name validation keeps the existing %s message", (value, expected) => {
  expect(validateDisplayName(value)).toBe(expected);
});
test.each([["", "Username is required"], ["aa", "3–20 chars: lowercase letters, numbers, underscore"], ["a".repeat(21), "3–20 chars: lowercase letters, numbers, underscore"], ["food-ie", "3–20 chars: lowercase letters, numbers, underscore"], [" FOOD_123 ", null]])("username validation keeps normalization and bounds", (value, expected) => {
  expect(validateUsername(value)).toBe(expected);
});
test("bio keeps the 280-character limit without changing whitespace", () => {
  expect(validateBio(" ".repeat(280))).toBeNull(); expect(validateBio(" ".repeat(281))).toBe("Bio must be 280 characters or less");
});
test("menu parser/serializer retain trimming, order, invalid-row removal, and empty semantics", () => {
  const input = [null, { title: " Empty ", items: [] }, { title: " Lunch ", items: [" Fish ", null, 5, "", "Rice"] }, { title: 4, items: [" Dumplings "] }];
  const clean = [{ title: "Lunch", items: ["Fish", "Rice"] }, { title: "", items: ["Dumplings"] }];
  expect(parseMenu(JSON.stringify(input))).toEqual(clean); expect(serializeMenu(clean)).toBe(JSON.stringify(clean));
  expect(parseMenu(null)).toEqual([]); expect(parseMenu(undefined)).toEqual([]); expect(parseMenu("{}")).toEqual([]);
  expect(serializeMenu(null)).toBeNull(); expect(serializeMenu(undefined)).toBeNull(); expect(serializeMenu([])).toBeNull();
});
test("malformed menu JSON retains the tolerant warning/fallback", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try { expect(parseMenu("bad json")).toEqual([]); expect(warn).toHaveBeenCalledWith("[restaurants] failed to parse menu"); }
  finally { warn.mockRestore(); }
});
