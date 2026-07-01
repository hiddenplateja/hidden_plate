// src/services/userPreferences.ts
// User preference layer — backed by Appwrite's account.prefs (a JSON blob
// stored on the user's auth account, not a database collection).
//
// Why account.prefs and not a collection:
//   - Built-in. Zero schema/permissions setup.
//   - Per-user storage is automatic — a user can only read/write their own
//     prefs (the SDK enforces this against the logged-in session).
//   - Function-side reads via Users API (users.getPrefs) work with API key.
//
// Limits:
//   - Total prefs payload capped at ~64KB. We use ~50 bytes. Non-issue.
//   - No querying across users. We don't need that — prefs are per-user.
//
// Defaults model:
//   - New users have empty prefs ({}). We layer DEFAULT_PREFERENCES on top
//     when reading so the app gets a fully-populated object regardless of
//     what's actually persisted.
//   - All notifications default ON (opt-out). The function applies the
//     same default when prefs are missing/empty.

import { account } from "@/services/appwrite";
import type { Parish } from "@/types/restaurant";

export interface UserPreferences {
  /** Master toggle — if false, all push notifications are suppressed. */
  notificationsEnabled: boolean;
  /** Push for "someone liked your review". */
  notifyOnLike: boolean;
  /** Push for "someone commented on your review". */
  notifyOnComment: boolean;
  /** Push for "someone followed you". */
  notifyOnFollow: boolean;
  /** Push for app-wide announcements (new restaurant added, etc). */
  notifyOnBroadcast: boolean;
  /** Cuisines/categories the user picked at onboarding (display-cased). */
  favoriteCuisines: string[];
  /** Parishes the user picked at onboarding. */
  favoriteParishes: Parish[];
  /** True between signup and finishing/skipping onboarding. */
  onboardingPending: boolean;
  /** ISO time of the last username change — rate-limits edits. null = never. */
  usernameChangedAt: string | null;
  /** ISO time of the last display-name change — rate-limits edits. null = never. */
  displayNameChangedAt: string | null;
  /**
   * Reviewer-badge ids the user has already been congratulated for. Drives the
   * "new badge earned" celebration (diff earned vs. seen). `null` = never
   * initialized: the next sync baselines to current badges WITHOUT celebrating,
   * so existing users aren't congratulated for badges they earned long ago.
   */
  seenBadgeIds: string[] | null;
}

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

// account.prefs stores arbitrary keys. We mix our typed keys in with anything
// else that might land there (future settings). On read, we cast and layer
// defaults so callers always get a complete UserPreferences.
type RawPrefs = Partial<UserPreferences> & Record<string, unknown>;

/**
 * Read the current user's preferences, layered over defaults.
 * Returns DEFAULT_PREFERENCES if not signed in or on any error — settings
 * UI should still render with defaults rather than crash.
 */
export async function getUserPreferences(): Promise<UserPreferences> {
  try {
    const raw = (await account.getPrefs()) as RawPrefs;
    return mergeWithDefaults(raw);
  } catch (err) {
    console.warn("[userPrefs] getPrefs failed:", err);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Update one or more preference keys. Other keys in account.prefs are
 * preserved (Appwrite's updatePrefs MERGES rather than replaces — but
 * only at the top level, so we read-merge-write to be safe).
 *
 * Returns the merged-with-defaults result so the UI can update state
 * with what's actually persisted.
 */
export async function updateUserPreferences(
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  try {
    // Read current to preserve any non-typed keys (e.g. settings we add later)
    const current = (await account.getPrefs()) as RawPrefs;
    const next = { ...current, ...patch };
    await account.updatePrefs(next);
    return mergeWithDefaults(next);
  } catch (err) {
    console.warn("[userPrefs] updatePrefs failed:", err);
    throw err; // Let caller surface the error — they made an intentional toggle
  }
}

function mergeWithDefaults(raw: RawPrefs): UserPreferences {
  return {
    notificationsEnabled:
      typeof raw.notificationsEnabled === "boolean"
        ? raw.notificationsEnabled
        : DEFAULT_PREFERENCES.notificationsEnabled,
    notifyOnLike:
      typeof raw.notifyOnLike === "boolean"
        ? raw.notifyOnLike
        : DEFAULT_PREFERENCES.notifyOnLike,
    notifyOnComment:
      typeof raw.notifyOnComment === "boolean"
        ? raw.notifyOnComment
        : DEFAULT_PREFERENCES.notifyOnComment,
    notifyOnFollow:
      typeof raw.notifyOnFollow === "boolean"
        ? raw.notifyOnFollow
        : DEFAULT_PREFERENCES.notifyOnFollow,
    notifyOnBroadcast:
      typeof raw.notifyOnBroadcast === "boolean"
        ? raw.notifyOnBroadcast
        : DEFAULT_PREFERENCES.notifyOnBroadcast,
    favoriteCuisines: Array.isArray(raw.favoriteCuisines)
      ? (raw.favoriteCuisines as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : DEFAULT_PREFERENCES.favoriteCuisines,
    favoriteParishes: Array.isArray(raw.favoriteParishes)
      ? (raw.favoriteParishes as Parish[])
      : DEFAULT_PREFERENCES.favoriteParishes,
    onboardingPending:
      typeof raw.onboardingPending === "boolean"
        ? raw.onboardingPending
        : DEFAULT_PREFERENCES.onboardingPending,
    usernameChangedAt:
      typeof raw.usernameChangedAt === "string" ? raw.usernameChangedAt : null,
    displayNameChangedAt:
      typeof raw.displayNameChangedAt === "string"
        ? raw.displayNameChangedAt
        : null,
    seenBadgeIds: Array.isArray(raw.seenBadgeIds)
      ? (raw.seenBadgeIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : null,
  };
}

/** Just the taste signals (favorites), for feed personalization. */
export async function getTastePreferences(): Promise<{
  favoriteCuisines: string[];
  favoriteParishes: Parish[];
}> {
  const prefs = await getUserPreferences();
  return {
    favoriteCuisines: prefs.favoriteCuisines,
    favoriteParishes: prefs.favoriteParishes,
  };
}

/** Flag whether the user still needs to see onboarding (set true at signup). */
export async function setOnboardingPending(pending: boolean): Promise<void> {
  await updateUserPreferences({ onboardingPending: pending });
}

/** Finish onboarding: persist taste favorites and clear the pending flag. */
export async function completeOnboarding(taste: {
  favoriteCuisines: string[];
  favoriteParishes: Parish[];
}): Promise<void> {
  await updateUserPreferences({
    favoriteCuisines: taste.favoriteCuisines,
    favoriteParishes: taste.favoriteParishes,
    onboardingPending: false,
    // Initialize the badge-celebration baseline to empty so a brand-new user's
    // first earned badge (e.g. their first review) is celebrated.
    seenBadgeIds: [],
  });
}
