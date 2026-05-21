// appwrite-functions/send-notification/src/main.js
// Appwrite Function — runs server-side with an API key.
//
// Two modes:
//
//   ─── Single-recipient mode (default) ────────────────────────────────
//   Payload: { userId, actorId, type, title, body, data, bumpCounter?, skipNotification? }
//   Sends to ONE recipient. Used by like/follow/comment triggers from
//   the client.
//
//   ─── Broadcast mode ──────────────────────────────────────────────────
//   Payload: { broadcast: true, type, title, body, data }
//   Fans out to ALL registered users:
//     - Writes one notification doc per user
//     - Sends one Expo push per token (chunked into batches of 100)
//   Used by the admin to announce new restaurants. Trigger this from the
//   Appwrite Console's Execute tab; no client UI invokes it.
//
// Why these distinctions exist:
//   - Counter bumps live server-side because reviews are owned by their
//     authors — other users can't update them.
//   - Push sends live server-side because the client must never read other
//     users' push tokens.
//   - Broadcasts live here for the same reason — a client doesn't have
//     read access to all users.
//
// IMPORTANT: in this project, the `users` collection uses an auto-generated
// document `$id` and stores the auth user ID in a separate `userId` field.
// When extracting recipient IDs for broadcasts and per-doc permissions, we
// MUST read `doc.userId`, NOT `doc.$id`. Using `$id` would set permissions
// for an ID that doesn't exist in the auth system, making the doc unreadable
// by anyone.
//
// Environment variables:
//   APPWRITE_API_KEY              an API key with db read/write
//   DATABASE_ID                   the database ID
//   NOTIFICATIONS_COLLECTION_ID   the notifications collection ID
//   PUSH_TOKENS_COLLECTION_ID     the pushTokens collection ID
//   REVIEWS_COLLECTION_ID         the reviews collection ID (for counter bumps)
//   USERS_COLLECTION_ID           the users collection ID (for broadcasts)

import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_BATCH_SIZE = 100; // Expo's limit per request
const PAGE_SIZE = 100; // Appwrite list pagination

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
    USERS_COLLECTION_ID,
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

  // ── Parse payload ───────────────────────────────────────────────────────
  let payload;
  try {
    payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    error("Invalid JSON body: " + err.message);
    return res.json({ success: false, error: "Invalid JSON" }, 400);
  }

  // ── ROUTE: broadcast vs single-recipient ────────────────────────────────
  if (payload.broadcast === true) {
    return handleBroadcast(payload, databases, {
      DATABASE_ID,
      NOTIFICATIONS_COLLECTION_ID,
      PUSH_TOKENS_COLLECTION_ID,
      USERS_COLLECTION_ID,
      res,
      log,
      error,
    });
  }

  return handleSingleRecipient(payload, databases, {
    DATABASE_ID,
    NOTIFICATIONS_COLLECTION_ID,
    PUSH_TOKENS_COLLECTION_ID,
    REVIEWS_COLLECTION_ID,
    res,
    log,
    error,
  });
};

// ─── Single-recipient handler ────────────────────────────────────────────────
async function handleSingleRecipient(payload, databases, ctx) {
  const {
    DATABASE_ID,
    NOTIFICATIONS_COLLECTION_ID,
    PUSH_TOKENS_COLLECTION_ID,
    REVIEWS_COLLECTION_ID,
    res,
    log,
    error,
  } = ctx;

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
        { success: false, error: "userId, type, title, and body are required" },
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
      error(`Counter bump failed: ${err.message}`);
    }
  }

  // Counter-only mode — return now
  if (isCounterOnly) {
    return res.json({ success: true, bumped: true, notified: false });
  }

  // ── B. Persist the notification doc ─────────────────────────────────────
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
  }

  // ── C. Look up tokens + send push ───────────────────────────────────────
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

  const messages = tokens.map((doc) => ({
    to: doc.token,
    title,
    body,
    sound: "default",
    priority: "high",
    data: { type, actorId: actorId || "", ...(data || {}) },
  }));

  try {
    const expoResult = await sendExpoPush(messages);
    log("Expo push response: " + JSON.stringify(expoResult));
    return res.json({
      success: true,
      pushed: true,
      tokens: tokens.length,
      result: expoResult,
    });
  } catch (err) {
    error("Expo push send failed: " + err.message);
    return res.json({ success: false, error: "Push delivery failed" }, 500);
  }
}

// ─── Broadcast handler ───────────────────────────────────────────────────────
async function handleBroadcast(payload, databases, ctx) {
  const {
    DATABASE_ID,
    NOTIFICATIONS_COLLECTION_ID,
    PUSH_TOKENS_COLLECTION_ID,
    USERS_COLLECTION_ID,
    res,
    log,
    error,
  } = ctx;

  const { type, title, body, data } = payload;

  if (!type || !title || !body) {
    return res.json(
      {
        success: false,
        error: "type, title, and body are required for broadcasts",
      },
      400,
    );
  }

  if (!USERS_COLLECTION_ID) {
    return res.json(
      {
        success: false,
        error: "Broadcasts require USERS_COLLECTION_ID env var to be set",
      },
      500,
    );
  }

  log(`Starting broadcast: type=${type}, title="${title}"`);

  // ── 1. Fetch all auth user IDs from the users collection ────────────────
  // IMPORTANT: extract `doc.userId` (the auth user ID), NOT `doc.$id` (the
  // database row's auto-generated ID). Permissions need the auth ID.
  const userIdSet = new Set();
  const userDocs = await paginateAllDocuments(
    databases,
    DATABASE_ID,
    USERS_COLLECTION_ID,
    (doc) => doc, // get the whole doc, we'll extract `userId` next
  );
  for (const doc of userDocs) {
    if (doc.userId && typeof doc.userId === "string") {
      userIdSet.add(doc.userId);
    }
  }
  const userIds = Array.from(userIdSet);
  log(`Broadcast targeting ${userIds.length} users`);

  // ── 2. Write a notification doc per user ────────────────────────────────
  // Each doc gets per-doc permissions scoped to the recipient's AUTH ID.
  let notifsCreated = 0;
  let notifsFailed = 0;
  const dataStr = data ? JSON.stringify(data) : null;

  // Process in chunks to avoid hammering the API
  const NOTIF_CHUNK = 25;
  for (let i = 0; i < userIds.length; i += NOTIF_CHUNK) {
    const chunk = userIds.slice(i, i + NOTIF_CHUNK);
    const results = await Promise.allSettled(
      chunk.map((uid) =>
        databases.createDocument(
          DATABASE_ID,
          NOTIFICATIONS_COLLECTION_ID,
          ID.unique(),
          {
            userId: uid,
            actorId: "", // broadcasts have no actor
            type,
            title,
            body,
            data: dataStr,
            isRead: false,
          },
          [
            Permission.read(Role.user(uid)),
            Permission.update(Role.user(uid)),
            Permission.delete(Role.user(uid)),
          ],
        ),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") notifsCreated++;
      else notifsFailed++;
    }
  }
  log(`Notifications: ${notifsCreated} created, ${notifsFailed} failed`);

  // ── 3. Fetch all push tokens (paginated) ────────────────────────────────
  const tokens = await paginateAllDocuments(
    databases,
    DATABASE_ID,
    PUSH_TOKENS_COLLECTION_ID,
    (doc) => doc.token,
  );
  log(`Broadcast sending to ${tokens.length} push tokens`);

  if (tokens.length === 0) {
    return res.json({
      success: true,
      pushed: 0,
      notifsCreated,
      notifsFailed,
      reason: "No push tokens registered",
    });
  }

  // ── 4. Send pushes in batches of PUSH_BATCH_SIZE (Expo's limit) ─────────
  let pushedOk = 0;
  let pushedErrors = 0;
  for (let i = 0; i < tokens.length; i += PUSH_BATCH_SIZE) {
    const batch = tokens.slice(i, i + PUSH_BATCH_SIZE);
    const messages = batch.map((token) => ({
      to: token,
      title,
      body,
      sound: "default",
      priority: "high",
      data: { type, ...(data || {}) },
    }));

    try {
      const result = await sendExpoPush(messages);
      if (result && Array.isArray(result.data)) {
        for (const ticket of result.data) {
          if (ticket.status === "ok") pushedOk++;
          else pushedErrors++;
        }
      } else {
        pushedOk += batch.length;
      }
      log(`Batch ${i / PUSH_BATCH_SIZE + 1}: ${batch.length} sent`);
    } catch (err) {
      error(`Batch ${i / PUSH_BATCH_SIZE + 1} failed: ${err.message}`);
      pushedErrors += batch.length;
    }
  }

  log(`Broadcast complete: ${pushedOk} ok, ${pushedErrors} errors`);

  return res.json({
    success: true,
    broadcast: true,
    targeted: userIds.length,
    notifsCreated,
    notifsFailed,
    tokens: tokens.length,
    pushedOk,
    pushedErrors,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Page through every document in a collection, applying `extract` to each
 * to produce the desired result array.
 *
 * Uses cursor-based pagination — safe across very large collections.
 */
async function paginateAllDocuments(
  databases,
  databaseId,
  collectionId,
  extract,
) {
  const out = [];
  let cursor = null;
  for (let safety = 0; safety < 200; safety++) {
    const queries = [Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(
      databaseId,
      collectionId,
      queries,
    );
    if (res.documents.length === 0) break;
    for (const doc of res.documents) out.push(extract(doc));
    if (res.documents.length < PAGE_SIZE) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return out;
}

/**
 * Wrapper around the Expo Push API.
 * Throws on network/HTTP error; caller wraps in try/catch.
 */
async function sendExpoPush(messages) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    throw new Error(`Expo push returned ${response.status}`);
  }
  return await response.json();
}
