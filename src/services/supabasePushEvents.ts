// SDK-free until a valid signed-in event actually needs inbox verification.
import { getRuntimeSupabaseServices } from "@/services/backendRuntime";
import { captureSupabaseActionIdentity } from "@/services/supabaseSessionFence";
import type { AppNotification } from "@/types/notification";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function verifySupabasePushEvent(data: unknown): Promise<AppNotification | null> {
  const identity = captureSupabaseActionIdentity();
  if (!identity.userId || !data || typeof data !== "object" || !("notificationId" in data)
    || typeof data.notificationId !== "string" || !UUID.test(data.notificationId)) return null;
  const id = data.notificationId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    const result = await Promise.race([
      (async () => {
        const module = await (await getRuntimeSupabaseServices()).gateway.load("notifications");
        const current = captureSupabaseActionIdentity();
        if (expired || current.userId !== identity.userId || current.revision !== identity.revision) return null;
        return module.resolveSupabasePushNotification(id, identity.userId!);
      })(),
      new Promise<null>(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 1800); }),
    ]);
    const current = captureSupabaseActionIdentity();
    return current.userId === identity.userId && current.revision === identity.revision && result?.userId === identity.userId ? result : null;
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
/** Routes come from the verified inbox row, never arbitrary push payload paths. */
export function verifiedNotificationDestination(notification: AppNotification): string {
  const data = notification.data;
  if (notification.type === "like" || notification.type === "comment") {
    if (data.postId && UUID.test(data.postId)) return `/post/${data.postId}`;
    if (data.reviewId && UUID.test(data.reviewId)) return `/review/${data.reviewId}`;
  }
  if (notification.type === "new_restaurant" && data.restaurantId && UUID.test(data.restaurantId)) return `/restaurant/${data.restaurantId}`;
  return "/notifications";
}
