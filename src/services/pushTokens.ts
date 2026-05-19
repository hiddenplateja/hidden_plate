// src/services/pushTokens.ts
// Push token registration. Runs on app start (once logged in), saves the
// device's Expo push token to Appwrite so the send-notification Function
// can target it later.
//
// Notes:
//   - Push notifications DO NOT work on simulators/emulators. registerForPush
//     no-ops on those devices to avoid throwing.
//   - Tokens can change (app reinstall, restored backup, etc) so we re-save
//     on every login rather than trusting a cached "I've registered before"
//     flag. The unique index on (userId, token) prevents duplicates.
//   - The Function reads from this collection with an API key. The client
//     never reads tokens (we set no Read permission on the collection — only
//     create/update/delete by the token owner).

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
    AppwriteException,
    ID,
    Permission,
    Query,
    Role,
} from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";

export class PushTokenError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PushTokenError";
  }
}

interface PushTokenDoc {
  $id: string;
  userId: string;
  token: string;
  platform: "ios" | "android";
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
      await saveTokenToDatabase(userId, token);
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
 * Save the token to Appwrite if not already present.
 * Idempotent — relies on the unique (userId, token) index.
 */
async function saveTokenToDatabase(
  userId: string,
  token: string,
): Promise<void> {
  try {
    // Check first — cheaper than relying on unique-index error
    const existing = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.pushTokens,
      [
        Query.equal("userId", userId),
        Query.equal("token", token),
        Query.limit(1),
      ],
    );
    if (existing.total > 0) return;

    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.pushTokens,
      ID.unique(),
      {
        userId,
        token,
        platform: Platform.OS as "ios" | "android",
      },
      [
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ],
    );
  } catch (err) {
    // Unique-index violation is fine — token already saved by another flow
    if (err instanceof AppwriteException && err.code === 409) return;
    console.warn("[pushTokens] save failed:", err);
  }
}

/**
 * Remove all push tokens for this user. Called on logout so the device
 * stops receiving pushes for an account that's no longer signed in.
 *
 * Best-effort — a failure here is logged but not thrown.
 */
export async function clearPushTokensForUser(userId: string): Promise<void> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.pushTokens,
      [Query.equal("userId", userId), Query.limit(100)],
    );
    await Promise.all(
      res.documents.map((doc) =>
        databases.deleteDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.pushTokens,
          (doc as unknown as PushTokenDoc).$id,
        ),
      ),
    );
  } catch (err) {
    console.warn("[pushTokens] clear failed:", err);
  }
}
