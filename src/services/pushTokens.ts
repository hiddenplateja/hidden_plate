// src/services/pushTokens.ts
// Push token registration. Runs on app start (once logged in), saves the
// device's Expo push token to Appwrite so the send-notification Function
// can target it later.
//
// SECURITY: registration + clearing are routed through the send-notification
// Function, NOT written directly by the client. The Function binds every
// token to the authenticated caller (x-appwrite-user-id) and ignores any
// client-supplied userId, so nobody can register their device under another
// user's account and siphon that victim's pushes. The pushTokens collection
// grants NO create/write permission to Users — only the Function's API key
// writes it. See APPWRITE_SETUP.md §15.
//
// Notes:
//   - Push notifications DO NOT work on simulators/emulators. registerForPush
//     no-ops on those devices to avoid throwing.
//   - Tokens can change (app reinstall, restored backup, etc) so we re-save
//     on every login. The Function is idempotent (unique (userId, token)).

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { ExecutionMethod } from "react-native-appwrite";
import { Platform } from "react-native";

import { appwriteConfig, functions } from "@/services/appwrite";

export class PushTokenError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PushTokenError";
  }
}

/**
 * Register this device for push and persist the token to Appwrite.
 *
 * Returns the token string on success, or null if:
 *   - running on a simulator/emulator (no push possible)
 *   - the user denied notification permissions
 *   - the Expo push service was unreachable
 *
 * Safe to call repeatedly — the unique (userId, token) index in Appwrite
 * makes duplicate inserts a no-op.
 */
export async function registerForPushNotifications(
  userId: string,
): Promise<string | null> {
  if (!Device.isDevice) {
    // Push notifications don't work on simulators/emulators. Quietly skip.
    return null;
  }

  // Permission check — request if not yet granted
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    console.warn("[pushTokens] notification permission denied");
    return null;
  }

  // Android-only channel setup. iOS doesn't use channels.
  // The default channel is what Expo Push uses unless explicitly overridden
  // in the push payload.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF6B35",
    });
  }

  // Read the EAS projectId — required for fetching an Expo push token.
  // Falls back to Constants.easConfig for older Expo versions.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

  if (!projectId) {
    console.error(
      "[pushTokens] no EAS projectId — check extra.eas.projectId in app.json",
    );
    return null;
  }

  // Fetch the Expo push token. Expo's service can return 503 transiently;
  // retry a couple of times before giving up.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      const token = tokenData.data;
      await saveTokenToDatabase(token);
      return token;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes("503") ||
        msg.includes("SERVICE_UNAVAILABLE") ||
        msg.includes("isTransient");

      if (isTransient && attempt < MAX_RETRIES) {
        console.warn(
          `[pushTokens] token fetch transient failure ${attempt}/${MAX_RETRIES}, retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error("[pushTokens] failed to get token:", err);
        return null;
      }
    }
  }

  return null;
}

/**
 * Register the token via the send-notification Function, which binds it to
 * the authenticated caller server-side. The client never writes the
 * pushTokens collection directly — see the security note at the top.
 *
 * Idempotent + best-effort: a failure here is logged, not thrown, since push
 * is non-critical to the user's primary action.
 */
async function saveTokenToDatabase(token: string): Promise<void> {
  if (!appwriteConfig.functions.sendNotification) {
    console.warn(
      "[pushTokens] no send-notification Function ID configured; skipping register",
    );
    return;
  }

  try {
    await functions.createExecution({
      functionId: appwriteConfig.functions.sendNotification,
      body: JSON.stringify({
        manageToken: "register",
        token,
        platform: Platform.OS,
      }),
      async: false,
      method: ExecutionMethod.POST,
    });
  } catch (err) {
    console.warn("[pushTokens] register failed:", err);
  }
}

/**
 * Remove all push tokens for the signed-in user via the Function (which binds
 * the delete to the authenticated caller — a client can't clear someone
 * else's tokens). Call this while the session is still alive (e.g. just
 * before signing out); once the session is gone the Function refuses the
 * anonymous call.
 *
 * The `userId` arg is retained for call-site compatibility/logging only — the
 * Function derives the real owner from the auth header, never from the client.
 *
 * Best-effort — a failure here is logged but not thrown.
 */
export async function clearPushTokensForUser(
  userId?: string,
): Promise<void> {
  if (!appwriteConfig.functions.sendNotification) return;

  try {
    // async: the execution is bound to the caller's auth header at enqueue
    // time, so it clears correctly even though the session is about to end —
    // and sign-out isn't blocked waiting for the deletes to finish.
    await functions.createExecution({
      functionId: appwriteConfig.functions.sendNotification,
      body: JSON.stringify({ manageToken: "clear" }),
      async: true,
      method: ExecutionMethod.POST,
    });
  } catch (err) {
    console.warn("[pushTokens] clear failed:", err);
  }
}
