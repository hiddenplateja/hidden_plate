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
  /** For like + comment notifications on a review */
  reviewId?: string;
  /** For like + comment notifications on a community post */
  postId?: string;
  /** For new_restaurant notifications */
  restaurantId?: string;
  /** Convenience: the actor's display name, used in the notification body */
  actorName?: string;
  /** Anything else — extensible */
  [key: string]: string | undefined;
}

/**
 * Optional counter-bump instruction for the send-notification Function.
 *
 * When present, the Function will increment the named field on the
 * review document AFTER (or instead of) creating the notification. This
 * runs with the Function's API key, so it bypasses the reviews collection's
 * Update permission (which restricts to the review author only).
 *
 * Used to keep likeCount and commentCount denormalized fields up to date
 * without exposing review Update permission to all users.
 */
export interface CounterBumpInstruction {
  reviewId: string;
  field: "likeCount" | "commentCount";
}

/**
 * Payload for invoking the send-notification Function.
 *
 * When skipNotification is true, only the bumpCounter step runs — no
 * notification doc is created and no push is sent. Used for self-actions
 * (you like your own review) and dedupe-skipped actions, where we still
 * want the counter accurate but don't want to spam the recipient.
 *
 * When skipNotification is false/undefined, the standard notification +
 * push flow runs, and bumpCounter (if present) is performed alongside.
 */
export interface SendNotificationInput {
  userId: string;
  actorId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
  bumpCounter?: CounterBumpInstruction;
  skipNotification?: boolean;
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
