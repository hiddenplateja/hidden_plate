// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/pushTokens";
import { dispatchBackendService } from "@/services/backendRuntime";
import { PushTokenError } from "@/services/serviceErrors";
export { PushTokenError } from "@/services/serviceErrors";
export const registerForPushNotifications: typeof Legacy.registerForPushNotifications = (...args) => dispatchBackendService<typeof Legacy.registerForPushNotifications>("pushTokens", "registerForPushNotifications", args, () => import("@/services/legacy/pushTokens"), PushTokenError);
export const clearPushTokensForUser: typeof Legacy.clearPushTokensForUser = (...args) => dispatchBackendService<typeof Legacy.clearPushTokensForUser>("pushTokens", "clearPushTokensForUser", args, () => import("@/services/legacy/pushTokens"), PushTokenError);
