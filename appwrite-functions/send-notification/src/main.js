// appwrite-functions/send-notification/src/main.js
// Appwrite Function — runs server-side with an API key.
//
// Three modes:
//
//   ─── Single-recipient mode (default, USER path) ─────────────────────
//   Payload: { userId, type, data, bumpCounter?, skipNotification? }
//   Sends to ONE recipient. REQUIRES a signed-in caller.
//   Honors recipient's notification prefs from account.prefs:
//     - notificationsEnabled (master)
//     - notifyOnLike, notifyOnComment, notifyOnFollow (matched against `type`)
//   When suppressed: counter bump still runs, but no notification doc is
//   created and no push is sent.
//
//   SECURITY: the actor identity is NEVER taken from the payload. We read
//   the caller's auth user ID from the x-appwrite-user-id header that
//   Appwrite injects for authenticated executions, and use THAT as actorId.
//   Set the function's Execute permission to "Users" (not "Any") so the
//   header is always present.
//
//   SECURITY: the notification TEXT is never taken from the payload either.
//   title/body are built server-side from `type`, the target kind
//   (data.reviewId vs data.postId), and the caller's REAL display name
//   looked up via the Users API. For comments, the snippet is read from the
//   caller's actual comment row in the DB — not the payload. A modified
//   client therefore cannot inject deceptive text or impersonate anyone.
//
//   SECURITY: bumpCounter is constrained. `field` must be one of
//   likeCount / commentCount, and the caller must own a corresponding row
//   (a like / a comment) on the target review before we touch its counter.
//   Rather than blindly incrementing, we SET the counter to the
//   authoritative count from the source-of-truth collection, so replayed
//   executions can't inflate it.
//
//   ─── Single-recipient mode (ADMIN path) ─────────────────────────────
//   Payload: { adminSecret, userId, type, title, body, actorId?, data? }
//   When a valid `adminSecret` is supplied, custom title/body/actorId are
//   trusted verbatim (still URL-filtered) and NO signed-in caller is
//   required. This is the path for sending a one-off notification to a
//   single user from the Appwrite Console or a trusted backend — the header
//   is absent there, so the secret is what authorizes it.
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
//   REVIEW_LIKES_COLLECTION_ID       source-of-truth for likeCount bumps
//   REVIEW_COMMENTS_COLLECTION_ID    source-of-truth for commentCount + review comment snippets
//   POST_COMMENTS_COLLECTION_ID      source-of-truth for post comment snippets
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

// Counter fields the Function is willing to touch, mapped to the env var
// holding the source-of-truth collection that proves the caller earned the
// bump. A caller may only bump a review's counter if they own a row (their
// like / their comment) on that review. Any field not listed here is
// rejected — this stops writes to arbitrary numeric attributes.
const COUNTER_FIELD_SOURCES = {
  likeCount: "REVIEW_LIKES_COLLECTION_ID",
  commentCount: "REVIEW_COMMENTS_COLLECTION_ID",
};

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
    REVIEW_LIKES_COLLECTION_ID,
    REVIEW_COMMENTS_COLLECTION_ID,
    POST_COMMENTS_COLLECTION_ID,
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

  // ── Review edit ─────────────────────────────────────────────────────────
  // The reviews collection grants its author NO direct update permission
  // (Appwrite document perms are all-or-nothing, so a direct grant would also
  // let a modified client flip isHidden or inflate likeCount/commentCount).
  // Authors edit their review's content through here instead: we verify
  // ownership from the injected auth header and write ONLY whitelisted content
  // fields — never moderation or counter state. Requires a signed-in caller.
  if (payload.editReview === true) {
    const editCaller = req.headers["x-appwrite-user-id"];
    if (!editCaller) {
      error("Review edit from anonymous caller — refusing");
      return res.json({ success: false, error: "Must be signed in" }, 401);
    }
    return handleReviewEdit(payload, databases, editCaller, {
      DATABASE_ID,
      REVIEWS_COLLECTION_ID,
      res,
      log,
      error,
    });
  }

  // ── Push-token management ───────────────────────────────────────────────
  // Register / clear this device's Expo push token. The token is ALWAYS bound
  // to the authenticated caller (x-appwrite-user-id) — a client-supplied
  // userId is never honored, so nobody can register their device under a
  // victim's account and siphon that victim's pushes. Requires a signed-in
  // caller (Execute permission = "Users").
  if (payload.manageToken === "register" || payload.manageToken === "clear") {
    const tokenCaller = req.headers["x-appwrite-user-id"];
    if (!tokenCaller) {
      error("Push-token call from anonymous caller — refusing");
      return res.json({ success: false, error: "Must be signed in" }, 401);
    }
    return handlePushToken(payload, databases, tokenCaller, {
      DATABASE_ID,
      PUSH_TOKENS_COLLECTION_ID,
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

  // ── Single-recipient auth ───────────────────────────────────────────────
  // Two ways to authorize:
  //   ADMIN path — a valid adminSecret. Trusted backend / Console; custom
  //     text allowed; no user session needed (the header is absent there).
  //   USER path  — the x-appwrite-user-id header Appwrite injects for
  //     authenticated executions. This is the trusted actor identity; text
  //     is built server-side. Requires Execute permission = "Users".
  // A call that is neither is anonymous and refused.
  const isAdmin = Boolean(ADMIN_SECRET) && payload.adminSecret === ADMIN_SECRET;
  const callerUserId = req.headers["x-appwrite-user-id"];
  if (!isAdmin && !callerUserId) {
    error("Single-recipient call from anonymous caller — refusing");
    return res.json({ success: false, error: "Must be signed in" }, 401);
  }

  return handleSingleRecipient(
    payload,
    databases,
    { isAdmin, callerUserId },
    users,
    {
      DATABASE_ID,
      NOTIFICATIONS_COLLECTION_ID,
      PUSH_TOKENS_COLLECTION_ID,
      REVIEWS_COLLECTION_ID,
      REVIEW_LIKES_COLLECTION_ID,
      REVIEW_COMMENTS_COLLECTION_ID,
      POST_COMMENTS_COLLECTION_ID,
      res,
      log,
      error,
    },
  );
};

function parseThreshold(raw) {
  if (!raw) return DEFAULT_MODERATION_THRESHOLD;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MODERATION_THRESHOLD;
}

// ─── Single-recipient handler ────────────────────────────────────────────────
// `auth` = { isAdmin, callerUserId }. In the USER path the actor identity and
// all notification text are derived server-side; the payload's actorId/title/
// body are ignored. In the ADMIN path (valid adminSecret) custom text is
// trusted verbatim.
async function handleSingleRecipient(payload, databases, auth, users, ctx) {
  const {
    DATABASE_ID,
    NOTIFICATIONS_COLLECTION_ID,
    PUSH_TOKENS_COLLECTION_ID,
    REVIEWS_COLLECTION_ID,
    REVIEW_LIKES_COLLECTION_ID,
    REVIEW_COMMENTS_COLLECTION_ID,
    POST_COMMENTS_COLLECTION_ID,
    res,
    log,
    error,
  } = ctx;

  const { isAdmin, callerUserId } = auth;
  const { userId, type, data, bumpCounter, skipNotification } = payload;

  // The acting user is the authenticated caller (user path) or whatever the
  // trusted admin supplies (admin path) — never an unauthenticated payload.
  const actorId = isAdmin ? payload.actorId || "" : callerUserId;

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
  } else if (!userId || !type) {
    return res.json(
      { success: false, error: "userId and type are required" },
      400,
    );
  }

  // Counter bump runs regardless of notification prefs — the counter is
  // visible to everyone (e.g. likeCount on a review). Prefs only control
  // whether the AUTHOR gets notified about it.
  //
  // A bump is only honored if it's whitelisted AND (user path) the caller
  // actually performed the action — owns a like / comment row on the review.
  // See applyCounterBump. A rejected bump fails the whole request: a counter-
  // only call with no valid action is an abuse attempt, and a notification
  // whose backing action doesn't exist would be a spoof.
  if (bumpCounter && (bumpCounter.reviewId || bumpCounter.field)) {
    const result = await applyCounterBump(
      databases,
      {
        DATABASE_ID,
        REVIEWS_COLLECTION_ID,
        REVIEW_LIKES_COLLECTION_ID,
        REVIEW_COMMENTS_COLLECTION_ID,
      },
      bumpCounter,
      callerUserId,
      { requireOwnership: !isAdmin },
      log,
      error,
    );
    if (!result.ok) {
      return res.json({ success: false, error: result.reason }, result.code);
    }
  }

  if (isCounterOnly) {
    return res.json({ success: true, bumped: true, notified: false });
  }

  // ── Resolve the notification's text + data ──────────────────────────────
  // Admin path trusts the payload (URL-filtered). User path builds everything
  // server-side from the trusted caller — see buildUserNotification.
  let title;
  let body;
  let outData;
  if (isAdmin) {
    title = payload.title;
    body = payload.body;
    outData = data || null;
    if (!title || !body) {
      return res.json(
        { success: false, error: "title and body are required" },
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
  } else {
    const built = await buildUserNotification(
      { userId, type, data },
      callerUserId,
      users,
      databases,
      { DATABASE_ID, REVIEW_COMMENTS_COLLECTION_ID, POST_COMMENTS_COLLECTION_ID },
      log,
      error,
    );
    if (!built.ok) {
      return res.json({ success: false, error: built.reason }, built.code);
    }
    title = built.title;
    body = built.body;
    outData = built.data;
    // Server-built text should never contain a URL, but the comment snippet
    // is user content pulled from the DB — filter as a final safety net.
    if (containsUrl(body)) {
      error("Built notification body contained a URL — rejected");
      return res.json(
        { success: false, error: "Content contains disallowed links" },
        400,
      );
    }
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

  const dataStr = outData ? JSON.stringify(outData) : null;

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
        data: dataStr,
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
    data: { type, actorId: actorId || "", ...(outData || {}) },
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

// ─── Push-token handler ──────────────────────────────────────────────────────
// `callerUserId` is the authenticated caller. The token is bound to THIS user
// and no other — the payload cannot name a different owner.
async function handlePushToken(payload, databases, callerUserId, ctx) {
  const { DATABASE_ID, PUSH_TOKENS_COLLECTION_ID, res, log, error } = ctx;
  const action = payload.manageToken;

  // ── Clear: delete every token row owned by the caller (logout) ──────────
  if (action === "clear") {
    let deleted = 0;
    try {
      const owned = await paginateAllDocuments(
        databases,
        DATABASE_ID,
        PUSH_TOKENS_COLLECTION_ID,
        (doc) => doc.$id,
        [Query.equal("userId", callerUserId)],
      );
      for (const id of owned) {
        try {
          await databases.deleteDocument(DATABASE_ID, PUSH_TOKENS_COLLECTION_ID, id);
          deleted++;
        } catch (err) {
          error(`Failed to delete token ${id}: ${err.message}`);
        }
      }
    } catch (err) {
      error(`Token clear failed: ${err.message}`);
      return res.json({ success: false, error: "Could not clear tokens" }, 500);
    }
    log(`Cleared ${deleted} push token(s) for user ${callerUserId}`);
    return res.json({ success: true, cleared: deleted });
  }

  // ── Register: bind this device's token to the caller ────────────────────
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const platform = payload.platform;

  if (!token) {
    return res.json({ success: false, error: "token is required" }, 400);
  }
  // Expo tokens look like ExponentPushToken[…] or ExpoPushToken[…]. Reject
  // anything else so the collection can't be stuffed with junk.
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
    return res.json({ success: false, error: "Not a valid Expo push token" }, 400);
  }
  if (platform !== "ios" && platform !== "android") {
    return res.json({ success: false, error: "platform must be ios or android" }, 400);
  }

  try {
    // A physical device runs one account at a time, so a token belongs to
    // exactly one user. Remove any rows for this token owned by ANYONE else
    // (e.g. a previous account on this device) so their pushes stop landing
    // here. Also lets us treat the caller's own existing row as idempotent.
    const sameToken = await databases.listDocuments(
      DATABASE_ID,
      PUSH_TOKENS_COLLECTION_ID,
      [Query.equal("token", token), Query.limit(100)],
    );

    let alreadyMine = false;
    for (const doc of sameToken.documents) {
      if (doc.userId === callerUserId) {
        alreadyMine = true;
        continue;
      }
      try {
        await databases.deleteDocument(DATABASE_ID, PUSH_TOKENS_COLLECTION_ID, doc.$id);
        log(`Reassigned token from stale owner ${doc.userId} to ${callerUserId}`);
      } catch (err) {
        error(`Failed to remove stale token row ${doc.$id}: ${err.message}`);
      }
    }

    if (alreadyMine) {
      return res.json({ success: true, created: false });
    }

    await databases.createDocument(
      DATABASE_ID,
      PUSH_TOKENS_COLLECTION_ID,
      ID.unique(),
      { userId: callerUserId, token, platform },
      [
        // Owner can read/delete their own token (needed for the logout clear
        // fallback); only the Function's API key ever writes new rows.
        Permission.read(Role.user(callerUserId)),
        Permission.update(Role.user(callerUserId)),
        Permission.delete(Role.user(callerUserId)),
      ],
    );
    log(`Registered push token for user ${callerUserId} (${platform})`);
    return res.json({ success: true, created: true });
  } catch (err) {
    // Unique-index race (another registration won) is fine.
    if (err.code === 409) {
      return res.json({ success: true, created: false });
    }
    error(`Token registration failed: ${err.message}`);
    return res.json({ success: false, error: "Could not register token" }, 500);
  }
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

// ─── Review edit handler ─────────────────────────────────────────────────────
// Owner-only edit of a review's user-authored content. The reviews collection
// grants the author no direct update permission, so this is the single path an
// author has to change their own review. We:
//   1. Verify the caller owns the review (userId matches the auth header).
//   2. Write ONLY whitelisted content fields (rating / comment / imageIds) plus
//      isEdited. isHidden, likeCount, commentCount, userId, restaurantId can
//      never be set from the payload — that's what makes un-hiding and counter
//      inflation impossible even from a modified client.
// Validation mirrors validateReviewInput on the client (rating range, comment
// length, link rejection, image count) so the server is the real boundary.
async function handleReviewEdit(payload, databases, callerUserId, ctx) {
  const { DATABASE_ID, REVIEWS_COLLECTION_ID, res, log, error } = ctx;

  const { reviewId, rating, comment, imageIds } = payload;

  if (!reviewId) {
    return res.json({ success: false, error: "reviewId required" }, 400);
  }
  if (!REVIEWS_COLLECTION_ID) {
    return res.json(
      {
        success: false,
        error: "Review edit requires REVIEWS_COLLECTION_ID env var",
      },
      500,
    );
  }

  // Ownership proof — load the review and confirm the caller authored it.
  let review;
  try {
    review = await databases.getDocument(
      DATABASE_ID,
      REVIEWS_COLLECTION_ID,
      reviewId,
    );
  } catch (err) {
    error(`Review edit: could not load review ${reviewId}: ${err.message}`);
    return res.json({ success: false, error: "Review not found" }, 404);
  }
  if (review.userId !== callerUserId) {
    error(
      `Review edit rejected: caller ${callerUserId} does not own review ${reviewId}`,
    );
    return res.json({ success: false, error: "Not your review" }, 403);
  }

  // Whitelisted update. Start with isEdited; add fields only after validating.
  const updates = { isEdited: true };

  if (rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.json(
        {
          success: false,
          error: "Rating must be a whole number from 1 to 5.",
        },
        400,
      );
    }
    updates.rating = rating;
  }

  if (comment !== undefined) {
    if (comment !== null) {
      if (typeof comment !== "string" || comment.length > 2000) {
        return res.json(
          {
            success: false,
            error: "Comment must be 2000 characters or less.",
          },
          400,
        );
      }
      if (containsUrl(comment)) {
        return res.json(
          {
            success: false,
            error: "Links aren't allowed. Please remove any URLs from your text.",
          },
          400,
        );
      }
    }
    updates.comment = comment;
  }

  if (imageIds !== undefined) {
    if (!Array.isArray(imageIds) || imageIds.length > 6) {
      return res.json(
        { success: false, error: "Up to 6 images per review." },
        400,
      );
    }
    updates.imageIds = imageIds;
  }

  try {
    // Re-assert the hardened permission set on every edit: read for all users,
    // delete for the author, and crucially NO update grant. This self-heals any
    // review created before authors lost direct update permission (those docs
    // still carry a stale Permission.update grant that would otherwise let the
    // author bypass this Function).
    const permissions = [
      Permission.read(Role.users()),
      Permission.delete(Role.user(callerUserId)),
    ];
    const updated = await databases.updateDocument(
      DATABASE_ID,
      REVIEWS_COLLECTION_ID,
      reviewId,
      updates,
      permissions,
    );
    log(`Review ${reviewId} edited by owner ${callerUserId}`);
    return res.json({ success: true, review: updated });
  } catch (err) {
    error(`Review edit write failed for ${reviewId}: ${err.message}`);
    return res.json({ success: false, error: "Could not update review" }, 500);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate and apply a review counter bump on behalf of `callerUserId`.
 *
 * Guarantees:
 *   1. `field` is whitelisted (likeCount / commentCount) — no writes to
 *      arbitrary numeric attributes.
 *   2. The caller owns a corresponding row (their like / their comment) on
 *      the target review — you can't bump a counter for an action you never
 *      performed, nor spam-bump a competitor's review.
 *   3. The counter is SET to the authoritative count from the source-of-
 *      truth collection, not blindly incremented — replayed executions
 *      can't inflate it, and this reconciles any prior drift.
 *
 * `opts.requireOwnership` (default true) enforces guarantee #2. The admin
 * path passes false — it's already trusted — but still gets the whitelist
 * and authoritative recount.
 *
 * Returns { ok: true } or { ok: false, code, reason }.
 */
async function applyCounterBump(
  databases,
  env,
  bumpCounter,
  callerUserId,
  opts,
  log,
  error,
) {
  const { reviewId, field } = bumpCounter;
  const requireOwnership = opts?.requireOwnership !== false;

  if (!reviewId || !field) {
    return { ok: false, code: 400, reason: "bumpCounter needs reviewId and field" };
  }

  const sourceEnvKey = COUNTER_FIELD_SOURCES[field];
  if (!sourceEnvKey) {
    error(`Rejected counter bump: field "${field}" is not allowed`);
    return { ok: false, code: 400, reason: "Unsupported counter field" };
  }

  const sourceCollectionId = env[sourceEnvKey];
  if (!env.REVIEWS_COLLECTION_ID || !sourceCollectionId) {
    error(`Counter bump not configured: missing REVIEWS_COLLECTION_ID or ${sourceEnvKey}`);
    return { ok: false, code: 500, reason: "Counter bump not configured on server" };
  }

  let authoritativeCount;
  try {
    // Ownership proof: does the caller have a row on this review?
    if (requireOwnership) {
      const proof = await databases.listDocuments(env.DATABASE_ID, sourceCollectionId, [
        Query.equal("reviewId", reviewId),
        Query.equal("userId", callerUserId),
        Query.limit(1),
      ]);
      if (proof.total === 0) {
        error(
          `Rejected counter bump: caller ${callerUserId} has no ${field} action on review ${reviewId}`,
        );
        return { ok: false, code: 403, reason: "Caller has not performed this action" };
      }
    }

    // Authoritative total across all users for this review.
    const all = await databases.listDocuments(env.DATABASE_ID, sourceCollectionId, [
      Query.equal("reviewId", reviewId),
      Query.limit(1),
    ]);
    authoritativeCount = all.total;
  } catch (err) {
    error(`Counter bump verification failed: ${err.message}`);
    return { ok: false, code: 500, reason: "Counter verification failed" };
  }

  try {
    await databases.updateDocument(env.DATABASE_ID, env.REVIEWS_COLLECTION_ID, reviewId, {
      [field]: authoritativeCount,
    });
    log(`Set ${field} on review ${reviewId} to authoritative count ${authoritativeCount}`);
    return { ok: true };
  } catch (err) {
    error(`Counter bump write failed: ${err.message}`);
    return { ok: false, code: 500, reason: "Counter write failed" };
  }
}

const SNIPPET_MAX = 80;

/**
 * Build a single-recipient notification entirely from trusted inputs (USER
 * path). Nothing user-facing comes from the payload except opaque target IDs
 * (reviewId / postId) whose only use is deep-linking.
 *
 *   - actorName: the caller's REAL display name from the Users API.
 *   - title/body: fixed templates chosen by `type` + target kind.
 *   - comment snippet: read from the caller's OWN comment row in the DB, then
 *     truncated — never the payload's claimed text.
 *
 * Returns { ok, code, reason } on failure, or
 * { ok: true, title, body, data } on success. `data` is a clean object with
 * only actorName + the relevant target id.
 */
async function buildUserNotification(payload, callerUserId, users, databases, env, log, error) {
  const { type, data } = payload;
  const reviewId = data && typeof data.reviewId === "string" ? data.reviewId : null;
  const postId = data && typeof data.postId === "string" ? data.postId : null;

  const actorName = await resolveActorName(users, callerUserId, log);

  const outData = { actorName };
  if (reviewId) outData.reviewId = reviewId;
  if (postId) outData.postId = postId;

  if (type === "follow") {
    return {
      ok: true,
      title: "New follower",
      body: `${actorName} started following you`,
      data: outData,
    };
  }

  if (type === "like") {
    if (reviewId) {
      return { ok: true, title: "New like", body: `${actorName} liked your review`, data: outData };
    }
    if (postId) {
      return { ok: true, title: "New like", body: `${actorName} liked your post`, data: outData };
    }
    return { ok: false, code: 400, reason: "like notification needs data.reviewId or data.postId" };
  }

  if (type === "comment") {
    const target = reviewId
      ? { collectionId: env.REVIEW_COMMENTS_COLLECTION_ID, idField: "reviewId", idValue: reviewId }
      : postId
        ? { collectionId: env.POST_COMMENTS_COLLECTION_ID, idField: "postId", idValue: postId }
        : null;
    if (!target) {
      return { ok: false, code: 400, reason: "comment notification needs data.reviewId or data.postId" };
    }
    if (!target.collectionId) {
      return { ok: false, code: 500, reason: "Comment snippets not configured on server" };
    }

    const snippet = await fetchOwnCommentSnippet(
      databases,
      env.DATABASE_ID,
      target,
      callerUserId,
      error,
    );
    // No comment by this caller on this target → they didn't actually comment.
    if (snippet === null) {
      error(
        `Rejected comment notification: caller ${callerUserId} has no comment on ${target.idField}=${target.idValue}`,
      );
      return { ok: false, code: 403, reason: "Caller has not commented on this" };
    }

    return {
      ok: true,
      title: "New comment",
      body: `${actorName}: ${snippet}`,
      data: outData,
    };
  }

  return { ok: false, code: 400, reason: `Unsupported notification type: ${type}` };
}

/** The caller's display name, or "Someone" if it can't be read. */
async function resolveActorName(users, userId, log) {
  try {
    const u = await users.get(userId);
    const name = (u.name || "").trim();
    return name || "Someone";
  } catch (err) {
    log(`Could not read actor name for ${userId}: ${err.message}`);
    return "Someone";
  }
}

/**
 * Fetch the caller's most recent comment on a target (review or post) and
 * return its text, truncated. Returns null if the caller has no comment there
 * (which doubles as the ownership check for comment notifications).
 */
async function fetchOwnCommentSnippet(databases, databaseId, target, callerUserId, error) {
  try {
    const res = await databases.listDocuments(databaseId, target.collectionId, [
      Query.equal(target.idField, target.idValue),
      Query.equal("userId", callerUserId),
      Query.orderDesc("$createdAt"),
      Query.limit(1),
    ]);
    if (res.documents.length === 0) return null;
    const text = (res.documents[0].text || "").trim();
    if (!text) return null;
    return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 3).trim()}…` : text;
  } catch (err) {
    error(`Failed to read comment snippet: ${err.message}`);
    // Treat read failure as "no proof" — safer to drop the notification than
    // to fall back to attacker-supplied text.
    return null;
  }
}

async function paginateAllDocuments(
  databases,
  databaseId,
  collectionId,
  extract,
  extraQueries = [],
) {
  const out = [];
  let cursor = null;
  for (let safety = 0; safety < 200; safety++) {
    const queries = [...extraQueries, Query.limit(PAGE_SIZE)];
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
