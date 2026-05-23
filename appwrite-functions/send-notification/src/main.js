// appwrite-functions/send-notification/src/main.js
// Appwrite Function — runs server-side with an API key.
//
// Three modes:
//
//   ─── Single-recipient mode (default) ────────────────────────────────
//   Payload: { userId, actorId, type, title, body, data, bumpCounter?, skipNotification? }
//   Sends to ONE recipient. Used by like/follow/comment triggers from
//   the client.
//
//   ─── Broadcast mode ──────────────────────────────────────────────────
//   Payload: { broadcast: true, adminSecret, type, title, body, data }
//   Fans out to ALL registered users. REQUIRES adminSecret matching the
//   ADMIN_SECRET env var. Without it the call is rejected. Used by the
//   admin to announce new restaurants from the Appwrite Console.
//
//   ─── Moderation mode ─────────────────────────────────────────────────
//   Payload: { moderation: true, reviewId }
//   Counts the reports filed against the given review. If count meets the
//   MODERATION_REPORT_THRESHOLD (default 3), sets review.isHidden=true.
//   Called by the reports service after a new report is filed.
//
// Why these distinctions exist:
//   - Counter bumps + report-based hides live server-side because reviews
//     are owned by their authors — other users can't update them.
//   - Push sends live server-side because the client must never read other
//     users' push tokens.
//   - Broadcasts live here for the same reason — a client doesn't have
//     read access to all users.
//
// IMPORTANT: in this project, the `users` collection uses an auto-generated
// document `$id` and stores the auth user ID in a separate `userId` field.
// When extracting recipient IDs for broadcasts and per-doc permissions, we
// MUST read `doc.userId`, NOT `doc.$id`.
//
// Environment variables:
//   APPWRITE_API_KEY                an API key with db read/write
//   DATABASE_ID                     the database ID
//   NOTIFICATIONS_COLLECTION_ID     the notifications collection ID
//   PUSH_TOKENS_COLLECTION_ID       the pushTokens collection ID
//   REVIEWS_COLLECTION_ID           the reviews collection ID (counter bumps + hide)
//   USERS_COLLECTION_ID             the users collection ID (broadcasts)
//   REVIEW_REPORTS_COLLECTION_ID    the reviewReports collection ID (moderation)
//   ADMIN_SECRET                    shared secret required for broadcasts
//   MODERATION_REPORT_THRESHOLD     optional, default 3 — auto-hide after N reports

import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_BATCH_SIZE = 100;
const PAGE_SIZE = 100;
const DEFAULT_MODERATION_THRESHOLD = 3;

// URL detection — mirrors the client-side regex in src/utils/contentValidation.ts.
// Kept in sync manually since the function runs in Node and can't import client TS.
const URL_REGEX =
  /(\b(?:https?|ftp):\/\/[^\s]+)|(\bwww\.[^\s]+\.[a-z]{2,}\b)|(\b[a-z0-9-]+\.(?:com|net|org|io|co|app|dev|me|info|biz|ly|gov|edu|jm)(?:\.[a-z]{2})?\b)/i;

function containsUrl(text) {
  if (!text || typeof text !== "string") return false;
  return URL_REGEX.test(text);
}

export default async ({ req, res, log, error }) => {
  const {
    APPWRITE_FUNCTION_API_ENDPOINT,
    APPWRITE_FUNCTION_PROJECT_ID,
    APPWRITE_API_KEY,
    DATABASE_ID,
    NOTIFICATIONS_COLLECTION_ID,
    PUSH_TOKENS_COLLECTION_ID,
    REVIEWS_COLLECTION_ID,
    USERS_COLLECTION_ID,
    REVIEW_REPORTS_COLLECTION_ID,
    ADMIN_SECRET,
    MODERATION_REPORT_THRESHOLD,
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

  const client = new Client()
    .setEndpoint(APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  const databases = new Databases(client);

  let payload;
  try {
    payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    error("Invalid JSON body: " + err.message);
    return res.json({ success: false, error: "Invalid JSON" }, 400);
  }

  // ── Route by mode ───────────────────────────────────────────────────────
  if (payload.moderation === true) {
    return handleModeration(payload, databases, {
      DATABASE_ID,
      REVIEWS_COLLECTION_ID,
      REVIEW_REPORTS_COLLECTION_ID,
      threshold: parseThreshold(MODERATION_REPORT_THRESHOLD),
      res,
      log,
      error,
    });
  }

  if (payload.broadcast === true) {
    // Verify admin secret BEFORE doing any work. Reject early so an attacker
    // who knows the function ID still can't spam users.
    if (!ADMIN_SECRET) {
      error("Broadcast attempted but ADMIN_SECRET is not configured");
      return res.json(
        { success: false, error: "Broadcast not configured on server" },
        500,
      );
    }
    if (payload.adminSecret !== ADMIN_SECRET) {
      error("Broadcast rejected: invalid or missing adminSecret");
      return res.json({ success: false, error: "Unauthorized" }, 403);
    }
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

function parseThreshold(raw) {
  if (!raw) return DEFAULT_MODERATION_THRESHOLD;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MODERATION_THRESHOLD;
}

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
    // Defense in depth: if a modified client manages to invoke the function
    // with URL-containing title/body, reject server-side too.
    if (containsUrl(title) || containsUrl(body)) {
      error("Notification text contained a URL — rejected");
      return res.json(
        { success: false, error: "Content contains disallowed links" },
        400,
      );
    }
  }

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

  if (isCounterOnly) {
    return res.json({ success: true, bumped: true, notified: false });
  }

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

  // Defense in depth — same as single-recipient. Admin shouldn't be posting
  // links via push either; if they want to share a URL, it goes in the
  // data.url field which deep-links into the app, not displayed text.
  if (containsUrl(title) || containsUrl(body)) {
    error("Broadcast text contained a URL — rejected");
    return res.json(
      { success: false, error: "Broadcast content contains disallowed links" },
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

  const userIdSet = new Set();
  const userDocs = await paginateAllDocuments(
    databases,
    DATABASE_ID,
    USERS_COLLECTION_ID,
    (doc) => doc,
  );
  for (const doc of userDocs) {
    if (doc.userId && typeof doc.userId === "string") {
      userIdSet.add(doc.userId);
    }
  }
  const userIds = Array.from(userIdSet);
  log(`Broadcast targeting ${userIds.length} users`);

  let notifsCreated = 0;
  let notifsFailed = 0;
  const dataStr = data ? JSON.stringify(data) : null;

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
            actorId: "",
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

// ─── Moderation handler ──────────────────────────────────────────────────────
async function handleModeration(payload, databases, ctx) {
  const {
    DATABASE_ID,
    REVIEWS_COLLECTION_ID,
    REVIEW_REPORTS_COLLECTION_ID,
    threshold,
    res,
    log,
    error,
  } = ctx;

  const { reviewId } = payload;

  if (!reviewId) {
    return res.json({ success: false, error: "reviewId required" }, 400);
  }

  if (!REVIEWS_COLLECTION_ID || !REVIEW_REPORTS_COLLECTION_ID) {
    return res.json(
      {
        success: false,
        error:
          "Moderation requires REVIEWS_COLLECTION_ID and REVIEW_REPORTS_COLLECTION_ID env vars",
      },
      500,
    );
  }

  // Count reports against this review. We use limit=1 because we only
  // need the `total` field — Appwrite returns the full count of matching
  // documents regardless of the page size.
  let totalReports;
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      REVIEW_REPORTS_COLLECTION_ID,
      [Query.equal("reviewId", reviewId), Query.limit(1)],
    );
    totalReports = result.total;
  } catch (err) {
    error("Failed to count reports: " + err.message);
    return res.json({ success: false, error: "Could not count reports" }, 500);
  }

  log(
    `Review ${reviewId} has ${totalReports} reports (threshold ${threshold})`,
  );

  if (totalReports < threshold) {
    return res.json({
      success: true,
      reviewId,
      reports: totalReports,
      threshold,
      hidden: false,
    });
  }

  // Threshold met — hide the review. Idempotent: if it's already hidden,
  // setting isHidden=true is a no-op. We don't bother reading the current
  // value first since the write is cheap.
  try {
    await databases.updateDocument(
      DATABASE_ID,
      REVIEWS_COLLECTION_ID,
      reviewId,
      { isHidden: true },
    );
    log(`Review ${reviewId} auto-hidden (${totalReports} reports)`);
    return res.json({
      success: true,
      reviewId,
      reports: totalReports,
      threshold,
      hidden: true,
    });
  } catch (err) {
    error("Failed to hide review: " + err.message);
    return res.json(
      {
        success: false,
        error: "Could not hide review",
        reports: totalReports,
      },
      500,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
