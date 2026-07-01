// Tests for the open/closed status logic — covers normal hours, before/after
// open, next-day + same-week lookahead, and overnight shifts crossing midnight.

import type { DayHours, OpeningHours } from "@/types/restaurant";
import { getOpenStatus, isOpenNow } from "@/utils/openStatus";

const NINE_TO_NINE: DayHours[] = [{ open: "09:00", close: "21:00" }];

const EVERY_DAY: OpeningHours = {
  mon: NINE_TO_NINE,
  tue: NINE_TO_NINE,
  wed: NINE_TO_NINE,
  thu: NINE_TO_NINE,
  fri: NINE_TO_NINE,
  sat: NINE_TO_NINE,
  sun: NINE_TO_NINE,
};

const CLOSED: OpeningHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

// Anchor dates (local time). 2024-01-01 is a Monday.
const MON = (h: number, m = 0) => new Date(2024, 0, 1, h, m);
const FRI = (h: number, m = 0) => new Date(2024, 0, 5, h, m);
const SAT = (h: number, m = 0) => new Date(2024, 0, 6, h, m);

describe("getOpenStatus", () => {
  it("returns unknown when there are no hours", () => {
    expect(getOpenStatus(null).state).toBe("unknown");
    expect(getOpenStatus(undefined).label).toBeNull();
  });

  it("is open during a normal slot, showing the close time", () => {
    const s = getOpenStatus(EVERY_DAY, MON(14));
    expect(s.state).toBe("open");
    expect(s.label).toBe("Open · closes 9 PM");
    expect(s.short).toBe("Open");
  });

  it("is closed before opening, pointing at today's open time", () => {
    const s = getOpenStatus(EVERY_DAY, MON(8));
    expect(s.state).toBe("closed");
    expect(s.label).toBe("Closed · opens 9 AM");
  });

  it("after close, points at tomorrow's opening", () => {
    const s = getOpenStatus(EVERY_DAY, MON(22));
    expect(s.state).toBe("closed");
    expect(s.label).toBe("Closed · opens tomorrow 9 AM");
  });

  it("looks ahead by weekday when closed for several days", () => {
    const wedOnly: OpeningHours = { ...CLOSED, wed: NINE_TO_NINE };
    const s = getOpenStatus(wedOnly, MON(10));
    expect(s.state).toBe("closed");
    expect(s.label).toBe("Closed · opens Wed 9 AM");
  });

  it("handles an overnight shift (evening side)", () => {
    const overnight: OpeningHours = { ...CLOSED, fri: [{ open: "18:00", close: "02:00" }] };
    const s = getOpenStatus(overnight, FRI(23));
    expect(s.state).toBe("open");
    expect(s.label).toBe("Open · closes 2 AM");
  });

  it("handles an overnight shift spilling into the next morning", () => {
    const overnight: OpeningHours = { ...CLOSED, fri: [{ open: "18:00", close: "02:00" }] };
    expect(getOpenStatus(overnight, SAT(1)).state).toBe("open"); // 1 AM Sat
    expect(getOpenStatus(overnight, SAT(3)).state).toBe("closed"); // after 2 AM
  });

  it("handles split shifts (lunch + dinner)", () => {
    const split: OpeningHours = {
      ...CLOSED,
      mon: [
        { open: "11:00", close: "14:00" },
        { open: "18:00", close: "22:00" },
      ],
    };
    expect(getOpenStatus(split, MON(12)).state).toBe("open");
    expect(getOpenStatus(split, MON(15)).label).toBe("Closed · opens 6 PM");
    expect(getOpenStatus(split, MON(20)).label).toBe("Open · closes 10 PM");
  });
});

describe("isOpenNow", () => {
  it("mirrors getOpenStatus open state", () => {
    expect(isOpenNow(EVERY_DAY, MON(14))).toBe(true);
    expect(isOpenNow(EVERY_DAY, MON(23))).toBe(false);
    expect(isOpenNow(null, MON(14))).toBe(false);
  });
});
