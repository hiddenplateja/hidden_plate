// src/utils/badgeTone.ts
// Maps a badge tone (pure tier metadata) to a real color. Kept out of the pure
// reviewerBadges module because it needs the active theme palette. Deep enough
// that a white medal glyph reads; coral/amber come from the theme so they shift
// in dark mode. Shared by the profile badges and the tier-guide sheet.

import type { ThemeColors } from "@/theme/themes";
import type { BadgeTone } from "@/utils/reviewerBadges";

export function badgeToneColor(tone: BadgeTone, colors: ThemeColors): string {
  switch (tone) {
    case "gold":
      return "#C7912B";
    case "amber":
      return colors.star;
    case "coral":
      return colors.primary;
    case "teal":
      return "#0E9C8A";
    case "blue":
      return "#2E7CD6";
    case "green":
      return "#2E9E54";
  }
}
