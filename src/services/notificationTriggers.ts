// src/services/notificationTriggers.ts
// Thin wrappers around the send-notification Appwrite Function.
//
// Each trigger composes two independent concerns:
//   1. COUNTER BUMP (always runs, server-side via Function)
//      Increments likeCount or commentCount on the parent review.
//      Lives in the Function because reviews are owned by their authors —
//      other users can't update them client-side. The Function bypasses
//      this with its API key.
//
//   2. NOTIFICATION (runs only when not self-action AND not deduped)
//      Persists a notification doc + sends a push banner via Expo.
//
// We pack both into a single Function call. When notification is skipped
// (self-action or dedupe), we still call the Function with
// `skipNotification: true` so the counter bump runs alone.
//
// Why counters MUST live server-side: see comment in main.js.
// Why push send lives server-side: client must never read other users'
// push tokens. Collection's Read perm is empty; only the API key reads it.

import { ExecutionMethod } from "react-native-appwrite";

import { appwriteConfig, functions } from "@/services/appwrite";
import { hasRecentSimilarNotification } from "@/services/notifications";
import type {
  CounterBumpInstruction,
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
    console.warn("[notificationTriggers] no Function ID configured; skipping");
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
    // Failed dispatch must never break the user's primary action.
    // We log loudly so it's visible during development.
    console.warn("[notificationTriggers] sendNotification failed:", err);
  }
}

interface BaseInput {
  recipientUserId: string;
  actorId: string;
  actorName: string;
}

/**
 * Should we fire a notification (vs only bumping the counter)?
 *   - Skip if actor === recipient (no self-notifications)
 *   - Skip if a recent matching unread notification already exists (dedupe)
 *
 * Returns the decision; callers use it to set skipNotification on the
 * Function payload.
 */
async function shouldNotify(
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
 *
 * Deep-links to the follower's profile. No counter bump — follows aren't
 * denormalized on the user doc.
 *
 * Notification skipped on self-follow attempts (the follows service also
 * blocks these earlier) and on dedupe.
 */
export async function triggerFollowNotification(
  input: BaseInput,
): Promise<void> {
  const notify = await shouldNotify(input, "follow");
  if (!notify) return; // nothing to do — no counter to bump on follows

  const data: NotificationData = { actorName: input.actorName };

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
 *
 * Always bumps likeCount on the review doc. Notification fires only if
 * the actor isn't the recipient and there's no recent unread like
 * notification for the same (actor, recipient, review).
 *
 * Self-likes still bump the counter, so my own like on my own review
 * counts toward "social proof". (Per common social-app convention.)
 */
export async function triggerLikeNotification(
  input: BaseInput & { reviewId: string },
): Promise<void> {
  const notify = await shouldNotify(input, "like", input.reviewId);

  const bumpCounter: CounterBumpInstruction = {
    reviewId: input.reviewId,
    field: "likeCount",
  };

  if (!notify) {
    // Counter-only call
    await invokeSendNotification({
      userId: input.recipientUserId,
      actorId: input.actorId,
      type: "like",
      title: "",
      body: "",
      bumpCounter,
      skipNotification: true,
    });
    return;
  }

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
    bumpCounter,
  });
}

/**
 * Someone commented on your review.
 *
 * Always bumps commentCount on the review doc. Notification fires only if
 * the actor isn't the recipient and there's no recent unread comment
 * notification for the same (actor, recipient, review).
 */
export async function triggerCommentNotification(
  input: BaseInput & { reviewId: string; commentSnippet: string },
): Promise<void> {
  const notify = await shouldNotify(input, "comment", input.reviewId);

  const bumpCounter: CounterBumpInstruction = {
    reviewId: input.reviewId,
    field: "commentCount",
  };

  if (!notify) {
    // Counter-only call
    await invokeSendNotification({
      userId: input.recipientUserId,
      actorId: input.actorId,
      type: "comment",
      title: "",
      body: "",
      bumpCounter,
      skipNotification: true,
    });
    return;
  }

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
    bumpCounter,
  });
}
