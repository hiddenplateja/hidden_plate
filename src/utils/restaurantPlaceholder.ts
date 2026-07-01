// src/utils/restaurantPlaceholder.ts
// Deterministic monogram-tile styling for restaurants without a photo.
//
// Most bulk-imported spots have no image, so instead of an identical fork-knife
// on every card we show the restaurant's initial on a hue derived from its name.
// Same name → same color every render (stable hash), so the catalogue reads as
// intentional and varied rather than broken.

/** First alphanumeric character of the name, uppercased. Falls back to "?". */
export function restaurantInitial(name: string): string {
  const ch = name.trim().match(/[A-Za-z0-9]/)?.[0];
  return ch ? ch.toUpperCase() : "?";
}

/** Stable 0–359 hue from a seed string (djb2-ish). */
export function restaurantHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/**
 * Background + foreground colors for a monogram tile, tuned per theme so the
 * tile sits comfortably in the UI (soft tint in light mode, muted in dark).
 */
export function restaurantPlaceholderColors(
  seed: string,
  isDark: boolean,
): { bg: string; fg: string } {
  const hue = restaurantHue(seed);
  return isDark
    ? { bg: `hsl(${hue}, 32%, 20%)`, fg: `hsl(${hue}, 48%, 70%)` }
    : { bg: `hsl(${hue}, 56%, 92%)`, fg: `hsl(${hue}, 44%, 42%)` };
}
