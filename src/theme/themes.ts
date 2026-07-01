// src/theme/themes.ts
// Light + dark color palettes for the app's theming system.
//
// `lightColors` IS the existing static `colors` object, so screens that haven't
// been migrated to the theme context yet stay visually identical in light mode.
// Migrated screens read the active palette from `useTheme()`; non-color tokens
// (spacing, radius, shadows, fonts, typography) are theme-independent and keep
// coming from `colors.ts`.

import { colors as lightColors } from "./colors";

// Every color key, widened to `string` (the static `colors` is `as const`, so
// its literal types can't describe the dark variant).
export type ThemeColors = { readonly [K in keyof typeof lightColors]: string };

export const darkColors: ThemeColors = {
  // Brand — coral brightened a touch so it pops on dark surfaces.
  primary: "#FF6B5C",
  primaryDark: "#E94B3C",
  primaryLight: "#3A211E", // dark coral tint (chips, icon tiles)

  // Neutrals
  background: "#121316",
  surface: "#23252A",
  border: "#34373E",
  text: "#F3F4F6",
  textPrimary: "#F3F4F6",
  textSecondary: "#AAB0BA",
  textMuted: "#787E89",
  textInverse: "#FFFFFF", // text on the coral primary / on overlays

  // Page surfaces — page is darkest, cards sit slightly above it.
  pageBackground: "#0E0F12",
  cardBackground: "#1A1C20",
  divider: "#2A2D34",

  // Status
  error: "#F97066",
  errorBg: "#3A1F1D",
  success: "#32D583",
  warning: "#FDB022",

  // Accents
  star: "#FBBF24",

  // Misc
  black: "#000000",
  white: "#FFFFFF",
  overlay: "rgba(0,0,0,0.6)",
};

export { lightColors };
