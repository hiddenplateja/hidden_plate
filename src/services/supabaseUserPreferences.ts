// Supabase-backed preferences. This is kept separate from the live Appwrite
// implementation until all authenticated app services have been moved.

import { assertSupabaseSessionCurrent, pinSupabaseSession } from "@/services/supabasePinnedSession";
import type { UserPreferences } from "@/services/userPreferences";
import { DEFAULT_PREFERENCES } from "@/utils/userPreferencesModel";
import type { Parish } from "@/types/restaurant";

type RawPrefs = Partial<UserPreferences> & Record<string, unknown>;

export function mergeSupabasePreferences(raw: RawPrefs): UserPreferences {
  return {
    notificationsEnabled: typeof raw.notificationsEnabled === "boolean" ? raw.notificationsEnabled : DEFAULT_PREFERENCES.notificationsEnabled,
    notifyOnLike: typeof raw.notifyOnLike === "boolean" ? raw.notifyOnLike : DEFAULT_PREFERENCES.notifyOnLike,
    notifyOnComment: typeof raw.notifyOnComment === "boolean" ? raw.notifyOnComment : DEFAULT_PREFERENCES.notifyOnComment,
    notifyOnFollow: typeof raw.notifyOnFollow === "boolean" ? raw.notifyOnFollow : DEFAULT_PREFERENCES.notifyOnFollow,
    notifyOnBroadcast: typeof raw.notifyOnBroadcast === "boolean" ? raw.notifyOnBroadcast : DEFAULT_PREFERENCES.notifyOnBroadcast,
    favoriteCuisines: Array.isArray(raw.favoriteCuisines)
      ? raw.favoriteCuisines.filter((item): item is string => typeof item === "string")
      : DEFAULT_PREFERENCES.favoriteCuisines,
    favoriteParishes: Array.isArray(raw.favoriteParishes)
      ? (raw.favoriteParishes as Parish[])
      : DEFAULT_PREFERENCES.favoriteParishes,
    onboardingPending: typeof raw.onboardingPending === "boolean" ? raw.onboardingPending : DEFAULT_PREFERENCES.onboardingPending,
    usernameChangedAt: typeof raw.usernameChangedAt === "string" ? raw.usernameChangedAt : null,
    displayNameChangedAt: typeof raw.displayNameChangedAt === "string" ? raw.displayNameChangedAt : null,
    seenBadgeIds: Array.isArray(raw.seenBadgeIds)
      ? raw.seenBadgeIds.filter((item): item is string => typeof item === "string")
      : null,
  };
}

export async function getSupabaseUserPreferences(): Promise<UserPreferences> {
  try {
    const pinned = await pinSupabaseSession();
    if (!pinned) return { ...DEFAULT_PREFERENCES };

    const { data, error } = await pinned.client
      .from("profiles")
      .select("preferences")
      .eq("id", pinned.userId)
      .single().setHeader("Authorization", `Bearer ${pinned.accessToken}`);

    await assertSupabaseSessionCurrent(pinned);
    if (error) throw error;
    return mergeSupabasePreferences((data.preferences ?? {}) as RawPrefs);
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export async function updateSupabaseUserPreferences(
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const pinned = await pinSupabaseSession();
  if (!pinned) throw new Error("You must be signed in. Your account may have changed.");
  await assertSupabaseSessionCurrent(pinned);
  const { data,error }=await pinned.client.rpc("merge_my_preferences",{ preference_patch:patch })
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseSessionCurrent(pinned);
  if (error) throw new Error(error.message);
  if (!data || typeof data!=="object" || Array.isArray(data)) throw new Error("Couldn't load your settings.");
  return mergeSupabasePreferences(data as RawPrefs);
}
