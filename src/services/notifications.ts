// src/services/notifications.ts
// In-app notifications: fetch, mark read, delete.
//
// Notifications are *created* by the send-notification Appwrite Function
// (server-side, called via notificationTriggers). The client only reads
// and updates its own notification docs here.
//
// Per-doc permissions are set by the Function so only the recipient can
// read/update/delete their notifications.

import { AppwriteException, Query } from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import type {
    AppNotification,
    NotificationData,
    NotificationPage,
    NotificationType,
} from "@/types/notification";

// ---------- Errors ----------

export class NotificationError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

function toNotificationError(
  err: unknown,
  fallback: string,
): NotificationError {
  if (err instanceof AppwriteException) {
    return new NotificationError(err.message || fallback, err.type);
  }
  return new NotificationError(fallback);
}

// ---------- Mapping ----------

interface NotificationDoc {
  $id: string;
  $createdAt: string;
  userId: string;
  actorId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** JSON-encoded NotificationData payload */
  data: string | null;
  isRead: boolean;
}

function parseData(raw: string | null | undefined): NotificationData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // Bad/legacy data — return empty object so consumers don't crash
    return {};
  }
}

function mapDoc(doc: NotificationDoc): AppNotification {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    userId: doc.userId,
    actorId: doc.actorId ?? "",
    type: doc.type,
    title: doc.title,
    body: doc.body,
    data: parseData(doc.data),
    isRead: doc.isRead ?? false,
  };
}

// ---------- Public API ----------

const PAGE_SIZE = 20;
// We retain at most this many notifications per user. Fetch caps at this.
// (Older notifications stay in the DB but are not surfaced to clients.)
const MAX_RETAIN = 100;

interface ListOptions {
  pageSize?: number;
  cursor?: string | null;
}

/**
 * List the current user's notifications, newest first.
 */
export async function listMyNotifications(
  options: ListOptions = {},
): Promise<NotificationPage> {
  let me;
  try {
    me = await account.get();
  } catch {
    return { items: [], total: 0, hasMore: false, nextCursor: null };
  }

  const { pageSize = PAGE_SIZE, cursor } = options;

  const queries: string[] = [
    Query.equal("userId", me.$id),
    Query.orderDesc("$createdAt"),
    Query.limit(Math.min(pageSize, MAX_RETAIN)),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.notifications,
      queries,
    );
    const items = (res.documents as unknown as NotificationDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    throw toNotificationError(err, "Failed to load notifications.");
  }
}

/**
 * Count of unread notifications for the current user.
 * Used to drive the bell's badge.
 */
export async function getUnreadCount(): Promise<number> {
  let me;
  try {
    me = await account.get();
  } catch {
    return 0;
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.notifications,
      [
        Query.equal("userId", me.$id),
        Query.equal("isRead", false),
        Query.limit(1), // we only need `total`
      ],
    );
    return res.total;
  } catch (err) {
    console.warn("[notifications] getUnreadCount failed:", err);
    return 0;
  }
}

/**
 * Mark a single notification as read.
 */
export async function markRead(notificationId: string): Promise<void> {
  try {
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.notifications,
      notificationId,
      { isRead: true },
    );
  } catch (err) {
    throw toNotificationError(err, "Failed to mark notification as read.");
  }
}

/**
 * Mark every unread notification for the current user as read.
 * Done in parallel — failures on individual docs are logged but don't
 * fail the whole batch.
 */
export async function markAllRead(): Promise<void> {
  let me;
  try {
    me = await account.get();
  } catch {
    return;
  }

  try {
    // Fetch up to MAX_RETAIN unread — anything older is functionally invisible
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.notifications,
      [
        Query.equal("userId", me.$id),
        Query.equal("isRead", false),
        Query.limit(MAX_RETAIN),
      ],
    );

    await Promise.allSettled(
      res.documents.map((doc) =>
        databases.updateDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.notifications,
          (doc as unknown as NotificationDoc).$id,
          { isRead: true },
        ),
      ),
    );
  } catch (err) {
    throw toNotificationError(err, "Failed to mark notifications as read.");
  }
}

/**
 * Delete a single notification (used for swipe-to-delete in the UI).
 */
export async function deleteNotification(
  notificationId: string,
): Promise<void> {
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.notifications,
      notificationId,
    );
  } catch (err) {
    throw toNotificationError(err, "Failed to delete notification.");
  }
}

/**
 * Check whether a recent unread notification of the same (actor, type, target)
 * already exists. Used for anti-spam coalescing — e.g., if someone likes and
 * unlikes a review repeatedly, we don't create a new notification each time.
 *
 * Looks back over the most recent MAX_RETAIN notifications for the recipient.
 * Returns true if a matching unread notification is found.
 *
 * Note: this runs from the trigger side (the user who is *performing* the
 * action), but they query the recipient's notifications. That requires the
 * notifications collection's collection-level Read permission to be set to
 * `users` (any logged-in user). See the setup notes.
 */
export async function hasRecentSimilarNotification(input: {
  recipientUserId: string;
  actorId: string;
  type: NotificationType;
  /** Optional review/restaurant id — narrows the dedupe match further */
  targetId?: string;
}): Promise<boolean> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.notifications,
      [
        Query.equal("userId", input.recipientUserId),
        Query.equal("actorId", input.actorId),
        Query.equal("type", input.type),
        Query.equal("isRead", false),
        Query.orderDesc("$createdAt"),
        Query.limit(5),
      ],
    );

    if (res.documents.length === 0) return false;

    // If a targetId was given, narrow further by checking the parsed data
    if (input.targetId) {
      for (const doc of res.documents) {
        const data = parseData((doc as unknown as NotificationDoc).data);
        if (
          data.reviewId === input.targetId ||
          data.restaurantId === input.targetId
        ) {
          return true;
        }
      }
      return false;
    }

    return true;
  } catch (err) {
    // Don't block notification creation on a dedupe check failure
    console.warn("[notifications] hasRecentSimilarNotification failed:", err);
    return false;
  }
}
