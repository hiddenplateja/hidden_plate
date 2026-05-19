// src/theme/colors.ts
// Design tokens — single source of truth.

export const colors = {
  // Brand
  primary: "#E94B3C",
  primaryDark: "#C2392C",
  primaryLight: "#FDECEA",

  // Neutrals
  background: "#FFFFFF",
  surface: "#F8F8F8",
  border: "#E5E5E5",
  text: "#1A1A1A",
  textPrimary: "#1A1A1A", // alias for text — matches old codebase
  textSecondary: "#6B6B6B",
  textMuted: "#9B9B9B",
  textInverse: "#FFFFFF", // text on dark surfaces

  // Page surfaces (for the gray-page / white-card pattern)
  pageBackground: "#F2F3F5",
  cardBackground: "#FFFFFF",
  divider: "#E2E4E8",

  // Status
  error: "#D92D20",
  errorBg: "#FEF3F2",
  success: "#039855",
  warning: "#F79009",

  // Accents
  star: "#F4A523", // amber for star ratings

  // Misc
  black: "#000000",
  white: "#FFFFFF",
  overlay: "rgba(0,0,0,0.4)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
  huge: 96,
  // Semantic alias — horizontal screen padding
  screen: 16,
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  pill: 999,
  full: 999, // alias used in old code
} as const;

// Shadows — RN cross-platform. Use sparingly.
export const shadows = {
  xs: {
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

// Layout sizes — card dimensions, fixed UI heights, etc.
export const size = {
  featuredCardWidth: 280,
  featuredCardHeight: 200,
  nearbyCardWidth: 155,
  notifBtn: 44,
  chipHeight: 36,
} as const;

// Typography — Roboto-based.
// Font families: set up in src/theme/fonts.ts (loaded once at app start).
// Sizes/leading/tracking/weights collected here for use across the app.
export const fonts = {
  regular: "Roboto_400Regular",
  medium: "Roboto_500Medium",
  bold: "Roboto_700Bold",
  black: "Roboto_900Black",
} as const;

export const typographyTokens = {
  size: {
    xs: 11,
    sm: 13,
    base: 15,
    subDetail: 14,
    lg: 17,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  leading: {
    tight: 18,
    snug: 20,
    normal: 22,
    relaxed: 26,
  },
  tracking: {
    tight: -0.4,
    snug: -0.2,
    normal: 0,
    wider: 0.6,
  },
} as const;

// Legacy `typography` object (used by existing screens like login/signup).
// Kept as-is for backward compatibility — every screen we wrote in earlier
// phases imports `typography`.
export const typography = {
  h1: { fontSize: 32, fontWeight: "700" as const, lineHeight: 40 },
  h2: { fontSize: 24, fontWeight: "700" as const, lineHeight: 32 },
  h3: { fontSize: 20, fontWeight: "600" as const, lineHeight: 28 },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  bodyMedium: { fontSize: 16, fontWeight: "500" as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: "400" as const, lineHeight: 18 },
  button: { fontSize: 16, fontWeight: "600" as const, lineHeight: 20 },
} as const;
