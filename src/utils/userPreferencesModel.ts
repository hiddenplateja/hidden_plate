import type { UserPreferences } from "@/services/userPreferences";

// Pure defaults shared by both backends. The type-only import does not load
// the Appwrite client when the Supabase adapter is imported.
export const DEFAULT_PREFERENCES: UserPreferences = {
  notificationsEnabled: true,
  notifyOnLike: true,
  notifyOnComment: true,
  notifyOnFollow: true,
  notifyOnBroadcast: true,
  favoriteCuisines: [],
  favoriteParishes: [],
  onboardingPending: false,
  usernameChangedAt: null,
  displayNameChangedAt: null,
  seenBadgeIds: null,
};
