// src/constants/routes.ts
// Centralized route paths. Use these instead of raw strings in router.push().

export const ROUTES = {
  login: "/(auth)/login",
  signup: "/(auth)/signup",
  home: "/(tabs)",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
