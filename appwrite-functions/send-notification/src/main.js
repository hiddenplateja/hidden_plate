// send-notification/src/main.js
// Appwrite Function — runs server-side with an API key.
//
// Receives: { userId, actorId, type, title, body, data } via req.body
//
// Does:
//   1. Persists a notification doc to the `notifications` collection
//      with per-doc Read/Update/Delete permissions for the recipient
//   2. Looks up the recipient's push tokens in `pushTokens`
//   3. Calls Expo's push API to deliver banners to those devices
//
// Why this lives server-side:
//   The client never reads other users' push tokens (security). The
//   collection's Read permission is empty — only this Function (with the
//   API key from env) can read tokens.
//
// Environment variables required:
//   APPWRITE_API_KEY              an API key with database read/write
//   DATABASE_ID                    the database ID
//   NOTIFICATIONS_COLLECTION_ID    the notifications collection ID
//   PUSH_TOKENS_COLLECTION_ID      the pushTokens collection ID

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

  const { userId, actorId, type, title, body, data } = payload;

  if (!userId || !type || !title || !body) {
    return res.json(
      {
        success: false,
        error: "userId, type, title, and body are required",
      },
      400,
    );
  }

  // ── 1. Persist the notification doc ─────────────────────────────────────
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

  // ── 2. Look up recipient's push tokens ──────────────────────────────────
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

  // ── 3. Build + send Expo Push messages ──────────────────────────────────
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
    return res.json(
      { success: false, error: "Push delivery failed" },
      500,
    );
  }
};
