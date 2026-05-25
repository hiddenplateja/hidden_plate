// appwrite-functions/send-notification/src/main.js
// Appwrite Function — runs server-side with an API key.
//
// Three modes:
//
//   ─── Single-recipient mode (default) ────────────────────────────────
//   Payload: { userId, actorId, type, title, body, data, bumpCounter?, skipNotification? }
//   Sends to ONE recipient.
//   Honors recipient's notification prefs from account.prefs:
//     - notificationsEnabled (master)
//     - notifyOnLike, notifyOnComment, notifyOnFollow (matched against `type`)
//   When suppressed: counter bump still runs, but no notification doc is
//   created and no push is sent.
//
//   ─── Broadcast mode ──────────────────────────────────────────────────
//   Payload: { broadcast: true, adminSecret, type, title, body, data }
//   Fans out to ALL registered users. REQUIRES adminSecret.
//   Honors per-recipient notifyOnBroadcast + notificationsEnabled prefs —
//   recipients with broadcasts disabled don't get a doc or a push.
//
//   ─── Moderation mode ─────────────────────────────────────────────────
//   Payload: { moderation: true, reviewId }
//   Counts reports; auto-hides at threshold.
//
// IMPORTANT: in this project, the `users` collection uses an auto-generated
// document `$id` and stores the auth user ID in a separate `userId` field.
// When extracting recipient IDs for broadcasts and per-doc permissions, we
// MUST read `doc.userId`, NOT `doc.$id`.
//
// Environment variables:
//   APPWRITE_API_KEY                an API key with db read/write + users.read
//   DATABASE_ID
//   NOTIFICATIONS_COLLECTION_ID
//   PUSH_TOKENS_COLLECTION_ID
//   REVIEWS_COLLECTION_ID
//   USERS_COLLECTION_ID
//   REVIEW_REPORTS_COLLECTION_ID
//   ADMIN_SECRET
//   MODERATION_REPORT_THRESHOLD     optional, default 3

import {
  Client,
  Databases,
  ID,
  Permission,
  Query,
  Role,
  Users,
} from "node-appwrite";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_BATCH_SIZE = 100;
const PAGE_SIZE = 100;
const DEFAULT_MODERATION_THRESHOLD = 3;

// URL detection — mirrors src/utils/contentValidation.ts
const URL_REGEX =
  /(\b(?:https?|ftp):\/\/[^\s]+)|(\bwww\.[^\s]+\.[a-z]{2,}\b)|(\b[a-z0-9-]+\.(?:com|net|org|io|co|app|dev|me|info|biz|ly|gov|edu|jm)(?:\.[a-z]{2})?\b)/i;

function containsUrl(text) {
  if (!text || typeof text !== "string") return false;
  return URL_REGEX.test(text);
}

// Map notification type → preference key. Add new types here as we add them.
// If a type has no entry, it's treated as "always allowed" (subject to the
// master toggle only). Today everything has an entry.
const TYPE_TO_PREF_KEY = {
  like: "notifyOnLike",
  comment: "notifyOnComment",
  follow: "notifyOnFollow",
  new_restaurant: "notifyOnBroadcast",
  broadcast: "notifyOnBroadcast",
};

/**
 * Read a recipient's notification prefs via Users API and decide whether
 * the given notification type should be delivered.
 *
 * Defaults are opt-out (everything allowed when unset). Returns true if
 * we should send, false if suppressed.
 */
async function shouldNotify(users, recipientUserId, type, log) {
  try {
    const prefs = await users.getPrefs(recipientUserId);

    // Master toggle — false means no notifications at all
    if (prefs.notificationsEnabled === false) {
      log(`Recipient ${recipientUserId}: master toggle off`);
      return false;
    }

    // Per-type toggle
    const key = TYPE_TO_PREF_KEY[type];
    if (key && prefs[key] === false) {
      log(`Recipient ${recipientUserId}: ${key} is off`);
      return false;
    }

    return true;
  } catch (err) {
    // If we can't read prefs (rare), default to sending. Better to over-
    // notify than to silently drop something the user expected.
    log(
      `Could not read prefs for ${recipientUserId}, defaulting to send: ${err.message}`,
    );
    return true;
  }
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
  const users = new Users(client);

  let payload;
  try {
    payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    error("Invalid JSON body: " + err.message);
    return res.json({ success: false, error: "Invalid JSON" }, 400);
  }

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
    return handleBroadcast(payload, databases, users, {
      DATABASE_ID,
      NOTIFICATIONS_COLLECTION_ID,
      PUSH_TOKENS_COLLECTION_ID,
      USERS_COLLECTION_ID,
      res,
      log,
      error,
    });
  }

  return handleSingleRecipient(payload, databases, users, {
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
async function handleSingleRecipient(payload, databases, users, ctx) {
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
    if (containsUrl(title) || containsUrl(body)) {
      error("Notification text contained a URL — rejected");
      return res.json(
        { success: false, error: "Content contains disallowed links" },
        400,
      );
    }
  }

  // Counter bump runs regardless of notification prefs — the counter is
  // visible to everyone (e.g. likeCount on a review). Prefs only control
  // whether the AUTHOR gets notified about it.
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

  // ── Prefs check — bail out before creating doc/sending push ─────────────
  const allowed = await shouldNotify(users, userId, type, log);
  if (!allowed) {
    return res.json({
      success: true,
      suppressed: true,
      reason: "Recipient has notifications disabled for this type",
    });
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
async function handleBroadcast(payload, databases, users, ctx) {
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
  const allUserIds = Array.from(userIdSet);
  log(`Broadcast considering ${allUserIds.length} users`);

  // ── Filter by per-user prefs ────────────────────────────────────────────
  // Sequentially batched so we don't blow Users API rate limits. At a few
  // hundred users this is fine; if you scale past a few thousand,
  // parallelize in chunks.
  const eligibleUserIds = [];
  let suppressed = 0;
  for (const uid of allUserIds) {
    const ok = await shouldNotify(users, uid, type, log);
    if (ok) eligibleUserIds.push(uid);
    else suppressed++;
  }
  log(
    `Broadcast eligible: ${eligibleUserIds.length} / ${allUserIds.length} (${suppressed} suppressed by prefs)`,
  );

  let notifsCreated = 0;
  let notifsFailed = 0;
  const dataStr = data ? JSON.stringify(data) : null;

  const NOTIF_CHUNK = 25;
  for (let i = 0; i < eligibleUserIds.length; i += NOTIF_CHUNK) {
    const chunk = eligibleUserIds.slice(i, i + NOTIF_CHUNK);
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

  // Push tokens — fetch only for eligible users so we don't push to
  // suppressed recipients. Easiest path: pull all tokens, filter to
  // those whose userId is in eligibleUserIds.
  const allTokenDocs = await paginateAllDocuments(
    databases,
    DATABASE_ID,
    PUSH_TOKENS_COLLECTION_ID,
    (doc) => doc,
  );
  const eligibleSet = new Set(eligibleUserIds);
  const tokens = allTokenDocs
    .filter((d) => eligibleSet.has(d.userId))
    .map((d) => d.token);
  log(`Broadcast sending to ${tokens.length} push tokens (filtered by prefs)`);

  if (tokens.length === 0) {
    return res.json({
      success: true,
      pushed: 0,
      notifsCreated,
      notifsFailed,
      suppressed,
      reason: "No eligible push tokens",
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
    targeted: allUserIds.length,
    eligible: eligibleUserIds.length,
    suppressed,
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
