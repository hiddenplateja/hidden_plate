import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { withRequestTimeout } from "@/utils/withRequestTimeout";
import { currentSupabaseSessionIdentity, pinSupabaseSession, type SupabaseSessionIdentity } from "@/services/supabasePinnedSession";

const tokenKey = (userId: string) => `hidden-plate:supabase:push:${userId}`;
// Serialize registration/cleanup so late old-user writes cannot run after new
// registration. No native listeners or operations start at module import.
let deviceOperation: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const operation = deviceOperation.then(work, work);
  deviceOperation = operation.catch(() => {}); return operation;
}

/** Staged replacement for the current Appwrite device-registration service. */
export async function registerForSupabasePushNotifications(expectedUserId?: string): Promise<string | null> {
  if (!Device.isDevice || (Platform.OS !== "android" && Platform.OS !== "ios")) return null;
  const expected = await currentSupabaseSessionIdentity().catch(() => null);
  if (!expected || (expectedUserId !== undefined && expected.userId !== expectedUserId)) return null;
  return serialize(() => registerDevice(expected));
}
async function registerDevice(expected: SupabaseSessionIdentity): Promise<string | null> {
  if (!Device.isDevice || (Platform.OS !== "android" && Platform.OS !== "ios")) return null;
  const pinned = await pinSupabaseSession(expected).catch(() => null);
  if (!pinned) return null;
  const userId = pinned.userId;
  try {
    // Android 13 requires a channel before requesting notification permission.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default", importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250], lightColor: "#FF6B35",
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const current = await currentSupabaseSessionIdentity();
    if (current?.userId !== userId || current.accessToken !== pinned.accessToken) return null;
    // Persist owner/device cleanup identity before any server write. If storage
    // fails, nothing is registered; an uncertain HTTP result keeps this retry key.
    await AsyncStorage.setItem(tokenKey(userId), token);
    const beforeWrite = await currentSupabaseSessionIdentity();
    if (beforeWrite?.userId !== userId || beforeWrite.accessToken !== pinned.accessToken) return null;
    const { error: registerError } = await withRequestTimeout(5000, signal => pinned.client.rpc("register_push_token", { push_token: token, device_platform: Platform.OS })
      .setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal));
    if (registerError) return null;
    const after = await currentSupabaseSessionIdentity();
    if (after?.userId !== userId || after.accessToken !== pinned.accessToken) {
      // Owner/device filters cannot remove a new account's token association.
      if (await deletePinnedToken(pinned, token)) await AsyncStorage.removeItem(tokenKey(userId));
      return null;
    }
    return token;
  } catch {
    // Tokens and session details must not appear in logs.
    return null;
  }
}
async function deletePinnedToken(pinned: NonNullable<Awaited<ReturnType<typeof pinSupabaseSession>>>, token: string): Promise<boolean> {
  const { error } = await withRequestTimeout(1500, signal => pinned.client.from("push_tokens").delete().eq("user_id", pinned.userId).eq("token", token)
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal));
  return !error;
}

/** Clear only this device's token while the user's session is still valid. */
export async function clearCurrentSupabasePushToken(expected?: SupabaseSessionIdentity): Promise<void> {
  const identity = expected ?? await currentSupabaseSessionIdentity();
  if (!identity) return;
  return serialize(async () => {
    const pinned = await pinSupabaseSession(identity); if (!pinned) return;
    const token = await AsyncStorage.getItem(tokenKey(pinned.userId)); if (!token) return;
    if (await deletePinnedToken(pinned, token)) await AsyncStorage.removeItem(tokenKey(pinned.userId));
  });
}
