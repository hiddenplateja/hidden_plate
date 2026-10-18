// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/notifications";
import { dispatchBackendService } from "@/services/backendRuntime";
import { NotificationError } from "@/services/serviceErrors";
export { NotificationError } from "@/services/serviceErrors";
export const listMyNotifications: typeof Legacy.listMyNotifications = (...args) => dispatchBackendService<typeof Legacy.listMyNotifications>("notifications", "listMyNotifications", args, () => import("@/services/legacy/notifications"), NotificationError);
export const getUnreadCount: typeof Legacy.getUnreadCount = (...args) => dispatchBackendService<typeof Legacy.getUnreadCount>("notifications", "getUnreadCount", args, () => import("@/services/legacy/notifications"), NotificationError);
export const markRead: typeof Legacy.markRead = (...args) => dispatchBackendService<typeof Legacy.markRead>("notifications", "markRead", args, () => import("@/services/legacy/notifications"), NotificationError);
export const markAllRead: typeof Legacy.markAllRead = (...args) => dispatchBackendService<typeof Legacy.markAllRead>("notifications", "markAllRead", args, () => import("@/services/legacy/notifications"), NotificationError);
export const deleteNotification: typeof Legacy.deleteNotification = (...args) => dispatchBackendService<typeof Legacy.deleteNotification>("notifications", "deleteNotification", args, () => import("@/services/legacy/notifications"), NotificationError);
export const hasRecentSimilarNotification: typeof Legacy.hasRecentSimilarNotification = (...args) => dispatchBackendService<typeof Legacy.hasRecentSimilarNotification>("notifications", "hasRecentSimilarNotification", args, () => import("@/services/legacy/notifications"), NotificationError, true);
