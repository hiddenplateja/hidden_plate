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
  // Brand — inverted monochrome: white actions on near-black surfaces.
  primary: "#FFFFFF",
  primaryDark: "#E4E4E7",
  primaryLight: "#26272B", // neutral tint (chips, icon tiles)
  onPrimary: "#0A0A0A", // text/icons on a primary-filled control

  // Neutrals
  background: "#121316",
  surface: "#23252A",
  border: "#34373E",
  text: "#F3F4F6",
  textPrimary: "#F3F4F6",
  textSecondary: "#AAB0BA",
  textMuted: "#787E89",
  textInverse: "#FFFFFF", // text on dark overlays

  // Page surfaces — page is darkest, cards sit slightly above it.
  pageBackground: "#0E0F12",
  cardBackground: "#1A1C20",
  divider: "#2A2D34",

  // Status
  error: "#F97066",
  errorBg: "#3A1F1D",
  success: "#32D583",
  successBg: "#132A1E",
  warning: "#FDB022",

  // Controls
  switchTrack: "#585C64", // mid-gray so the white thumb reads against the dark UI

  // Accents
  star: "#FBBF24",
  accent: "#FF5D52", // brand red brightened so it pops on dark surfaces
  accentDark: "#E24A3F", // pressed/active state for accent-filled controls

  // Misc
  black: "#000000",
  white: "#FFFFFF",
  overlay: "rgba(0,0,0,0.6)",
};

export { lightColors };
