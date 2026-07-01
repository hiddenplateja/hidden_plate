// src/constants/categoryIcons.ts
// Custom full-colour PNG icons for the home-screen category chips.
//
// HOW TO ADD AN ICON
//   1. Drop a PNG into  assets/icons/  — square, transparent background.
//      Ship it at ~3× the display size for crisp rendering: the chip draws it
//      at 16pt, so 48×48 (or 64×64) is ideal. (Optionally add @2x/@3x variants.)
//   2. Uncomment the matching line below. The `require` path is relative to
//      THIS file (src/constants → ../../assets/icons).
//
// Keys are the category ids from CATEGORIES in app/(tabs)/index.tsx
// ("all" | "jerk" | "seafood" | "patties" | "ital" | "sweets").
//
// Any category WITHOUT an entry here automatically falls back to its
// MaterialCommunityIcons glyph, so the chips keep working while you add art one
// at a time. Icons render full-colour (no tint), unchanged whether the chip is
// active or not — only the chip's background highlights.

export const CATEGORY_ICONS: Record<string, number> = {
  all: require("../../assets/icons/all.png"),
  jerk: require("../../assets/icons/jerk.png"),
  seafood: require("../../assets/icons/seafood.png"),
  patties: require("../../assets/icons/patties.png"),
  ital: require("../../assets/icons/ital.png"),
  sweets: require("../../assets/icons/sweets.png"),
};
