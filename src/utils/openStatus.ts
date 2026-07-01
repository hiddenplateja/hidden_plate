// src/utils/openStatus.ts
// Compute a restaurant's current open/closed status from its OpeningHours.
//
// Pure + timezone-naive: it compares against the device's local wall-clock,
// which for a Jamaica-only app is the same zone the hours are written in.
// Handles split shifts (e.g. lunch + dinner) and overnight hours that cross
// midnight (open 18:00, close 02:00).

import type { DayHours, OpeningHours } from "@/types/restaurant";

export type OpenState = "open" | "closed" | "unknown";

export interface OpenStatus {
  state: OpenState;
  /** Full label, e.g. "Open · closes 9 PM" / "Closed · opens 8 AM". null when unknown. */
  label: string | null;
  /** Just the word — "Open" / "Closed" — for tight spaces. null when unknown. */
  short: string | null;
}

const UNKNOWN: OpenStatus = { state: "unknown", label: null, short: null };

// JS getDay() (0=Sun) → OpeningHours key / short label.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** "22:00" → "10 PM", "09:30" → "9:30 AM". */
export function formatTime(hhmm: string): string {
  const mins = toMinutes(hhmm);
  if (mins == null) return hhmm;
  let h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0
    ? `${h} ${ampm}`
    : `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function daySlots(hours: OpeningHours, dayIndex: number): DayHours[] {
  const key = DAY_KEYS[((dayIndex % 7) + 7) % 7];
  const slots = hours[key];
  return Array.isArray(slots) ? slots : [];
}

/**
 * Current open/closed status for a set of opening hours.
 * Returns `unknown` (so callers render nothing) when hours are missing or
 * contain no valid slots — better than asserting "Closed" on bad data.
 */
export function getOpenStatus(
  hours: OpeningHours | null | undefined,
  now: Date = new Date(),
): OpenStatus {
  if (!hours) return UNKNOWN;

  const dayIndex = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // 1a) Open right now in one of today's slots (incl. an overnight evening
  //     shift whose close time is tomorrow).
  for (const slot of daySlots(hours, dayIndex)) {
    const open = toMinutes(slot.open);
    const close = toMinutes(slot.close);
    if (open == null || close == null) continue;
    const overnight = close <= open;
    const isOpen = overnight ? nowMin >= open : nowMin >= open && nowMin < close;
    if (isOpen) {
      return {
        state: "open",
        label: `Open · closes ${formatTime(slot.close)}`,
        short: "Open",
      };
    }
  }
  // 1b) Still inside yesterday's overnight shift that spilled past midnight.
  for (const slot of daySlots(hours, dayIndex - 1)) {
    const open = toMinutes(slot.open);
    const close = toMinutes(slot.close);
    if (open == null || close == null) continue;
    if (close <= open && nowMin < close) {
      return {
        state: "open",
        label: `Open · closes ${formatTime(slot.close)}`,
        short: "Open",
      };
    }
  }

  // 2) Closed — find the next opening within the coming 7 days.
  for (let offset = 0; offset < 7; offset++) {
    const slots = daySlots(hours, dayIndex + offset)
      .map((s) => ({ openM: toMinutes(s.open), open: s.open }))
      .filter((s): s is { openM: number; open: string } => s.openM != null)
      .sort((a, b) => a.openM - b.openM);
    for (const s of slots) {
      if (offset === 0 && s.openM <= nowMin) continue; // already passed today
      const when =
        offset === 0
          ? formatTime(s.open)
          : offset === 1
            ? `tomorrow ${formatTime(s.open)}`
            : `${DAY_LABELS[(dayIndex + offset) % 7]} ${formatTime(s.open)}`;
      return {
        state: "closed",
        label: `Closed · opens ${when}`,
        short: "Closed",
      };
    }
  }

  // Hours object present but no usable slots → don't assert "Closed".
  return UNKNOWN;
}

/** Convenience for filters: is this place open at `now`? */
export function isOpenNow(
  hours: OpeningHours | null | undefined,
  now: Date = new Date(),
): boolean {
  return getOpenStatus(hours, now).state === "open";
}
