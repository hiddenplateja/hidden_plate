// src/services/lastOAuth.ts
// Remembers the most recent successful OAuth identity (locally, on-device) so
// the auth screen can offer a one-tap "Continue as <name>" shortcut after the
// user signs out. Intentionally NOT cleared on logout — that's the whole point.
//
// Stores only display info (name/email/photo) + which provider. No tokens.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@hp_last_oauth";

export interface LastOAuth {
  provider: "google" | "apple";
  name: string;
  email: string;
  /** Provider profile photo URL (Google). null for Apple / when unavailable. */
  photoUrl: string | null;
}

export async function getLastOAuth(): Promise<LastOAuth | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastOAuth>;
    if (v && (v.provider === "google" || v.provider === "apple")) {
      return {
        provider: v.provider,
        name: typeof v.name === "string" ? v.name : "",
        email: typeof v.email === "string" ? v.email : "",
        photoUrl: typeof v.photoUrl === "string" ? v.photoUrl : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setLastOAuth(value: LastOAuth): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // best-effort — a missed convenience shortcut is harmless
  }
}

export async function clearLastOAuth(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
