// appwrite-functions/send-notification/src/main.js
// Appwrite Function — runs server-side with an API key.
//
// Receives via req.body:
//   {
//     userId, actorId, type, title, body, data,
//     bumpCounter?:      { reviewId, field: "likeCount" | "commentCount" },
//     skipNotification?: boolean  // when true, only does the counter bump
//   }
//
// Two distinct operations, composable in one call:
//
//   A. Counter bump (when bumpCounter is set)
//      Increments a denormalized counter (likeCount / commentCount) on the
//      parent review. Runs with the Function's API key so it bypasses
//      reviews' Update permission (which restricts to the review author).
//
//   B. Notification persist + push (when skipNotification !== true)
//      Writes the notification doc with per-doc permissions for the
//      recipient, then fans out to all the recipient's push tokens via
//      Expo Push API.
//
// Both A and B can happen in the same call. Or A alone (skipNotification=true).
// Or B alone (no bumpCounter). The client chooses which combination based
// on context (self-actions only bump, dedupe-skipped actions only bump).
//
// Environment variables required:
//   APPWRITE_API_KEY              an API key with database read/write
//   DATABASE_ID                   the database ID
//   NOTIFICATIONS_COLLECTION_ID   the notifications collection ID
//   PUSH_TOKENS_COLLECTION_ID     the pushTokens collection ID
//   REVIEWS_COLLECTION_ID         the reviews collection ID (for counter bumps)

import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";

export default async ({ req, res, log, error }) => {
  // ── Validate env ────────────────────────────────────────────────────────
  const {
    APPWRITE_FUNCTION_API_ENDPOINT,
    APPWRITE_FUNCTION_PROJECT_ID,
    APPWRITE_API_KEY,
    DATABASE_ID,
    NOTIFICATIONS_COLLECTION_ID,
    PUSH_TOKENS_COLLECTION_ID,
    REVIEWS_COLLECTION_ID,
  } = process.env;

  if (
    !APPWRITE_API_KEY ||
    !DATABASE_ID ||
    !NOTIFICATIONS_COLLECTION_ID ||
    !PUSH_TOKENS_COLLECTION_ID
  ) {
    error("Missing required environment variables");
    return res.json(
      { success: false, error: "Server configuration error" },
      500,
    );
  }

  // ── Set up Appwrite client with API key (server-side privileges) ────────
  const client = new Client()
    .setEndpoint(APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  const databases = new Databases(client);

  // ── Parse + validate payload ────────────────────────────────────────────
  let payload;
  try {
    payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    error("Invalid JSON body: " + err.message);
    return res.json({ success: false, error: "Invalid JSON" }, 400);
  }

  const {
    userId,
    actorId,
    type,
    title,
    body,
    data,
    bumpCounter,
    skipNotification,
  } = payload;

  // Counter-only mode requires bumpCounter; otherwise we need notification fields
  const isCounterOnly = skipNotification === true;
  if (isCounterOnly) {
    if (!bumpCounter || !bumpCounter.reviewId || !bumpCounter.field) {
      return res.json(
        {
          success: false,
          error: "bumpCounter required when skipNotification=true",
        },
        400,
      );
    }
  } else {
    if (!userId || !type || !title || !body) {
      return res.json(
        {
          success: false,
          error: "userId, type, title, and body are required",
        },
        400,
      );
    }
  }

  // ── A. Optional counter bump ────────────────────────────────────────────
  if (
    bumpCounter &&
    bumpCounter.reviewId &&
    bumpCounter.field &&
    REVIEWS_COLLECTION_ID
  ) {
    try {
      const review = await databases.getDocument(
        DATABASE_ID,
        REVIEWS_COLLECTION_ID,
        bumpCounter.reviewId,
      );
      const current = review[bumpCounter.field] ?? 0;
      await databases.updateDocument(
        DATABASE_ID,
        REVIEWS_COLLECTION_ID,
        bumpCounter.reviewId,
        { [bumpCounter.field]: current + 1 },
      );
      log(
        `Bumped ${bumpCounter.field} on review ${bumpCounter.reviewId}: ${current} -> ${current + 1}`,
      );
    } catch (err) {
      // Non-fatal — log and continue. Notification can still fire.
      error(`Counter bump failed: ${err.message}`);
    }
  }

  // Bump-only mode — return now without persisting/pushing
  if (isCounterOnly) {
    return res.json({ success: true, bumped: true, notified: false });
  }

  // ── B. Persist the notification doc ─────────────────────────────────────
  // Per-doc permissions: only the recipient can read/update/delete.
  // This is critical — the collection has no collection-level Read, so
  // without these per-doc perms the recipient can't see their own notifs.
  try {
    await databases.createDocument(
      DATABASE_ID,
      NOTIFICATIONS_COLLECTION_ID,
      ID.unique(),
      {
        userId,
        actorId: actorId || "",
        type,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
        isRead: false,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ],
    );
    log(`Notification doc created for user ${userId}, type=${type}`);
  } catch (err) {
    error("Failed to persist notification: " + err.message);
    // Don't return early — still try to send the push. The user might miss
    // the in-app row but still get the banner, which is better than nothing.
  }

  // ── B.2 Look up recipient's push tokens ─────────────────────────────────
  let tokens;
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      PUSH_TOKENS_COLLECTION_ID,
      [Query.equal("userId", userId), Query.limit(10)],
    );
    tokens = result.documents;
  } catch (err) {
    error("Failed to read push tokens: " + err.message);
    return res.json(
      { success: false, error: "Could not read tokens", pushed: false },
      500,
    );
  }

  if (tokens.length === 0) {
    log(`No push tokens for user ${userId} — in-app only`);
    return res.json({ success: true, pushed: false, reason: "No tokens" });
  }

  // ── B.3 Build + send Expo Push messages ─────────────────────────────────
  // Expo's API accepts an array of messages. One per token.
  // Critical: we include `type` in the `data` payload so the client's
  // notification listener can route deep-links correctly on tap.
  const messages = tokens.map((doc) => ({
    to: doc.token,
    title,
    body,
    sound: "default",
    priority: "high",
    data: {
      type,
      actorId: actorId || "",
      ...(data || {}),
    },
  }));

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    const result = await response.json();
    log("Expo push response: " + JSON.stringify(result));

    return res.json({
      success: true,
      pushed: true,
      tokens: tokens.length,
      result,
    });
  } catch (err) {
    error("Expo push send failed: " + err.message);
    return res.json({ success: false, error: "Push delivery failed" }, 500);
  }
};
