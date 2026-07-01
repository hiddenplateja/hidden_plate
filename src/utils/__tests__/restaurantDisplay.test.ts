import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

import { makeRestaurant } from "./fixtures";

describe("getCuisineLine", () => {
  it("joins the first cuisine with up to 2 categories", () => {
    const line = getCuisineLine(
      makeRestaurant({
        cuisines: ["Jamaican"],
        categories: ["Jerk", "BBQ", "Grill"],
      }),
    );
    expect(line).toBe("Jamaican • Jerk • BBQ");
  });

  it("works with a cuisine only", () => {
    expect(
      getCuisineLine(makeRestaurant({ cuisines: ["Jamaican"], categories: [] })),
    ).toBe("Jamaican");
  });

  it("works with categories only", () => {
    expect(
      getCuisineLine(makeRestaurant({ cuisines: [], categories: ["Jerk", "BBQ"] })),
    ).toBe("Jerk • BBQ");
  });

  it("returns null when there is nothing to show", () => {
    expect(
      getCuisineLine(makeRestaurant({ cuisines: [], categories: [] })),
    ).toBeNull();
  });
});

describe("getLocationLine", () => {
  it("prefers the city over the parish", () => {
    expect(
      getLocationLine(makeRestaurant({ city: "Montego Bay", parish: "st_james" })),
    ).toBe("Montego Bay");
  });

  it("trims surrounding whitespace from the city", () => {
    expect(getLocationLine(makeRestaurant({ city: "  Ocho Rios  " }))).toBe(
      "Ocho Rios",
    );
  });

  it("falls back to the parish label when there is no city", () => {
    expect(
      getLocationLine(makeRestaurant({ city: null, parish: "st_andrew" })),
    ).toBe("St. Andrew");
  });

  it("treats a blank city as missing", () => {
    expect(
      getLocationLine(makeRestaurant({ city: "   ", parish: "portland" })),
    ).toBe("Portland");
  });
});
