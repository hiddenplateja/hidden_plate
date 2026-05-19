// src/types/notification.ts
// Types for the in-app + push notification system.
//
// Four event types — pure social plus admin-broadcast:
//   follow         someone followed you
//   like           someone liked your review
//   comment        someone commented on your review
//   new_restaurant admin broadcast — new spot added to the app
//
// The `data` field is a JSON-encoded string in the DB (Appwrite doesn't
// support nested object attributes well). The service layer parses/stringifies
// it transparently, so consumers see a real object.

export type NotificationType = "follow" | "like" | "comment" | "new_restaurant";

export interface AppNotification {
  id: string;
  createdAt: string;
  /** The recipient of the notification (whose feed it appears in) */
  userId: string;
  /** The user who triggered the notification (the follower / liker / commenter). Empty for system pushes. */
  actorId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Parsed payload — deep-link targets, IDs, etc. Always an object. */
  data: NotificationData;
  isRead: boolean;
}

/**
 * Shape of the parsed `data` payload. Different per type, but all optional —
 * consumers should narrow based on `notification.type` before reading.
 */
export interface NotificationData {
  /** For like + comment notifications */
  reviewId?: string;
  /** For new_restaurant notifications */
  restaurantId?: string;
  /** Convenience: the actor's display name, used in the notification body */
  actorName?: string;
  /** Anything else — extensible */
  [key: string]: string | undefined;
}

/**
 * Payload for creating a notification (passed to the Appwrite Function).
 * The Function persists this AND sends the push.
 */
export interface SendNotificationInput {
  userId: string;
  actorId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Push token record stored in Appwrite. One per (user, device) pair.
 */
export interface PushTokenRecord {
  id: string;
  userId: string;
  token: string;
  platform: "ios" | "android";
  createdAt: string;
}
