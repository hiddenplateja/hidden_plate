// src/services/notificationTriggers.ts
// Thin wrappers around the send-notification Appwrite Function.
//
// Every trigger:
//   1. Skips self-notifications (you liking your own review, etc)
//   2. Dedupes against a recent matching unread notification (anti-spam)
//   3. Calls the Function with the right payload
//   4. Swallows errors — a failed notification must never break the user's
//      primary action (like, follow, comment). We log instead.
//
// The Function (Node.js, deployed in Appwrite Console) handles:
//   - Persisting the notification doc with correct per-doc permissions
//   - Reading the recipient's push tokens
//   - Calling the Expo Push API to deliver the push
//
// We never call the Expo Push API from the client — that would expose
// any user's push tokens to any other authenticated user.

import { ExecutionMethod } from "react-native-appwrite";

import { appwriteConfig, functions } from "@/services/appwrite";
import { hasRecentSimilarNotification } from "@/services/notifications";
import type {
    NotificationData,
    NotificationType,
    SendNotificationInput,
} from "@/types/notification";

/**
 * Low-level invocation. Don't call this directly from feature code —
 * use the typed wrappers below.
 */
async function invokeSendNotification(
  payload: SendNotificationInput,
): Promise<void> {
  if (!appwriteConfig.functions.sendNotification) {
    console.warn(
      "[notificationTriggers] no Function ID configured; skipping push",
    );
    return;
  }

  try {
    await functions.createExecution(
      appwriteConfig.functions.sendNotification,
      JSON.stringify(payload),
      true, // async — don't block the caller while Expo Push runs
      "/",
      ExecutionMethod.POST,
    );
  } catch (err) {
    // Failed notification dispatch must never break the user's primary
    // action. We log loudly so it's visible during development.
    console.warn("[notificationTriggers] sendNotification failed:", err);
  }
}

interface BaseInput {
  recipientUserId: string;
  actorId: string;
  actorName: string;
}

/**
 * Common pre-flight: should we send a notification of this type at all?
 *   - Skip if actor === recipient (no self-notifications)
 *   - Skip if a recent matching unread already exists (dedupe)
 */
async function shouldSend(
  input: BaseInput,
  type: NotificationType,
  targetId?: string,
): Promise<boolean> {
  if (input.recipientUserId === input.actorId) return false;

  const exists = await hasRecentSimilarNotification({
    recipientUserId: input.recipientUserId,
    actorId: input.actorId,
    type,
    targetId,
  });
  return !exists;
}

// ---------- Public triggers ----------

/**
 * Someone followed you.
 * Deep-links to the follower's profile.
 */
export async function triggerFollowNotification(
  input: BaseInput,
): Promise<void> {
  if (!(await shouldSend(input, "follow"))) return;

  const data: NotificationData = {
    actorName: input.actorName,
  };

  await invokeSendNotification({
    userId: input.recipientUserId,
    actorId: input.actorId,
    type: "follow",
    title: "New follower",
    body: `${input.actorName} started following you`,
    data,
  });
}

/**
 * Someone liked your review.
 * Deep-links to the dedicated review screen.
 */
export async function triggerLikeNotification(
  input: BaseInput & { reviewId: string },
): Promise<void> {
  if (!(await shouldSend(input, "like", input.reviewId))) return;

  const data: NotificationData = {
    actorName: input.actorName,
    reviewId: input.reviewId,
  };

  await invokeSendNotification({
    userId: input.recipientUserId,
    actorId: input.actorId,
    type: "like",
    title: "New like",
    body: `${input.actorName} liked your review`,
    data,
  });
}

/**
 * Someone commented on your review.
 * Deep-links to the dedicated review screen.
 */
export async function triggerCommentNotification(
  input: BaseInput & { reviewId: string; commentSnippet: string },
): Promise<void> {
  if (!(await shouldSend(input, "comment", input.reviewId))) return;

  // Trim long comments to keep the push body short. Expo limits push
  // payload size and most OSes truncate anyway.
  const snippet =
    input.commentSnippet.length > 80
      ? `${input.commentSnippet.slice(0, 77).trim()}…`
      : input.commentSnippet;

  const data: NotificationData = {
    actorName: input.actorName,
    reviewId: input.reviewId,
  };

  await invokeSendNotification({
    userId: input.recipientUserId,
    actorId: input.actorId,
    type: "comment",
    title: "New comment",
    body: `${input.actorName}: ${snippet}`,
    data,
  });
}
