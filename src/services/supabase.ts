// Shared Supabase client. Only the project URL and publishable key belong in
// the mobile app; service-role credentials must remain server-side.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { installNativeAuthCrypto } from "@/services/supabaseNativeCrypto";
import { recordSupabaseSession } from "@/services/supabaseSessionFence";
import { BACKEND_PUBLIC_CONFIGURATION } from "@/services/backendPublicConfiguration";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? BACKEND_PUBLIC_CONFIGURATION.supabaseUrl;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? BACKEND_PUBLIC_CONFIGURATION.publishableKey;

if (!url || !publishableKey) {
  throw new Error(
    "Missing Supabase configuration. Set EXPO_PUBLIC_SUPABASE_URL and " +
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
}

installNativeAuthCrypto();

export const supabase = createClient(url, publishableKey, {
  auth: {
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
    flowType: "pkce",
  },
});

// One observer for this shared client's module lifetime, not a React effect.
// No SDK calls, promises or React updates inside the auth-lock callback.
supabase.auth.onAuthStateChange((_event, session) => { recordSupabaseSession(session); });

/** Email proof/recovery must not publish a session to the app's auth provider. */
let isolatedAuthClientId = 0;
export function createIsolatedSupabaseAuthClient() {
  return createClient(url!, publishableKey!, {
    auth: {
      storageKey: `hidden-plate:isolated-auth:${++isolatedAuthClientId}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
}
