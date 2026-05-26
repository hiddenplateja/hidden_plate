// appwrite-functions/delete-account/src/main.js
// Account deletion — runs server-side with an API key.
//
// Authentication:
//   The caller must be signed in. We extract their auth user ID from the
//   x-appwrite-user-id header that Appwrite Functions injects when a logged-
//   in user invokes the function. NO trust on payload-supplied IDs — we
//   never let a client tell us "delete user X." It's always "delete the
//   user who's calling me."
//
// Cascade plan (must run in this order):
//   1. Soft-delete content the user authored — re-assign userId to the
//      sentinel "deleted_user". This preserves restaurant ratings and
//      comment threads.
//        - reviews
//        - reviewComments
//   2. Hard-delete personal/private data:
//        - reviewLikes
//        - saved (favorites/want_to_go/visited)
//        - follows (both directions)
//        - notifications
//        - pushTokens
//        - reviewReports (filed by this user)
//   3. Delete the users collection doc.
//   4. Delete the auth account — this is the last step because it kills
//      the caller's session and revokes their permissions.
//
// Failure handling:
//   Steps 1-3 are best-effort: each runs independently and logs failures
//   but doesn't abort. Step 4 is critical — if the auth deletion fails,
//   we return a non-2xx so the client knows to retry. Partial deletion
//   is recoverable (you can re-run the function or clean up in Console).
//
// IMPORTANT: this function needs broad scopes:
//   documents.read, documents.write, users.read, users.write
//
// Required env vars:
//   APPWRITE_API_KEY
//   DATABASE_ID
//   USERS_COLLECTION_ID
//   REVIEWS_COLLECTION_ID
//   REVIEW_COMMENTS_COLLECTION_ID
//   REVIEW_LIKES_COLLECTION_ID
//   SAVED_COLLECTION_ID
//   FOLLOWS_COLLECTION_ID
//   NOTIFICATIONS_COLLECTION_ID
//   PUSH_TOKENS_COLLECTION_ID
//   REVIEW_REPORTS_COLLECTION_ID

import { Client, Databases, Query, Users } from "node-appwrite";

const PAGE_SIZE = 100;
const SENTINEL_USER_ID = "deleted_user";

export default async ({ req, res, log, error }) => {
  const env = process.env;
  const required = [
    "APPWRITE_API_KEY",
    "DATABASE_ID",
    "USERS_COLLECTION_ID",
    "REVIEWS_COLLECTION_ID",
    "REVIEW_COMMENTS_COLLECTION_ID",
    "REVIEW_LIKES_COLLECTION_ID",
    "SAVED_COLLECTION_ID",
    "FOLLOWS_COLLECTION_ID",
    "NOTIFICATIONS_COLLECTION_ID",
    "PUSH_TOKENS_COLLECTION_ID",
    "REVIEW_REPORTS_COLLECTION_ID",
  ];
  for (const key of required) {
    if (!env[key]) {
      error(`Missing required env var: ${key}`);
      return res.json(
        { success: false, error: "Server configuration error" },
        500,
      );
    }
  }

  // ── Authenticate the caller ────────────────────────────────────────────
  // Appwrite injects x-appwrite-user-id when a logged-in user invokes the
  // function. If it's missing, the call is anonymous and we refuse.
  const callerUserId = req.headers["x-appwrite-user-id"];
  if (!callerUserId) {
    error("Anonymous caller — refusing");
    return res.json(
      { success: false, error: "Must be signed in to delete account" },
      401,
    );
  }
  log(`Account deletion requested by user ${callerUserId}`);

  // ── Set up clients ──────────────────────────────────────────────────────
  const client = new Client()
    .setEndpoint(env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const databases = new Databases(client);
  const users = new Users(client);

  const summary = {
    reviewsAnonymized: 0,
    commentsAnonymized: 0,
    likesDeleted: 0,
    savedDeleted: 0,
    followsDeleted: 0,
    notificationsDeleted: 0,
    pushTokensDeleted: 0,
    reportsDeleted: 0,
    userDocDeleted: false,
    authAccountDeleted: false,
    errors: [],
  };

  // ── 1a. Anonymize reviews ──────────────────────────────────────────────
  // Reviews go to the sentinel user. Restaurant ratings stay accurate.
  try {
    summary.reviewsAnonymized = await reassignUserId(
      databases,
      env.DATABASE_ID,
      env.REVIEWS_COLLECTION_ID,
      callerUserId,
      SENTINEL_USER_ID,
      log,
    );
  } catch (err) {
    error(`Review anonymization failed: ${err.message}`);
    summary.errors.push(`reviews: ${err.message}`);
  }

  // ── 1b. Anonymize comments ──────────────────────────────────────────────
  try {
    summary.commentsAnonymized = await reassignUserId(
      databases,
      env.DATABASE_ID,
      env.REVIEW_COMMENTS_COLLECTION_ID,
      callerUserId,
      SENTINEL_USER_ID,
      log,
    );
  } catch (err) {
    error(`Comment anonymization failed: ${err.message}`);
    summary.errors.push(`comments: ${err.message}`);
  }

  // ── 2. Hard deletes ─────────────────────────────────────────────────────
  // Each runs independently so a failure in one doesn't block the others.

  summary.likesDeleted = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.REVIEW_LIKES_COLLECTION_ID,
    "userId",
    callerUserId,
    log,
    error,
    summary.errors,
    "likes",
  );

  summary.savedDeleted = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.SAVED_COLLECTION_ID,
    "userId",
    callerUserId,
    log,
    error,
    summary.errors,
    "saved",
  );

  // Follows — both directions. The user is leaving so their follow rows
  // (where they're the follower) and their followers' rows (where they're
  // the followee) all become meaningless.
  // Common field names: followerId + followeeId, or follower + followed.
  // We try the conventional names; if your schema differs, update the
  // field names here.
  const followsFollower = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.FOLLOWS_COLLECTION_ID,
    "followerId",
    callerUserId,
    log,
    error,
    summary.errors,
    "follows(follower)",
  );
  const followsFollowee = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.FOLLOWS_COLLECTION_ID,
    "followingId",
    callerUserId,
    log,
    error,
    summary.errors,
    "follows(following)",
  );
  summary.followsDeleted = followsFollower + followsFollowee;

  summary.notificationsDeleted = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.NOTIFICATIONS_COLLECTION_ID,
    "userId",
    callerUserId,
    log,
    error,
    summary.errors,
    "notifications",
  );

  summary.pushTokensDeleted = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.PUSH_TOKENS_COLLECTION_ID,
    "userId",
    callerUserId,
    log,
    error,
    summary.errors,
    "pushTokens",
  );

  summary.reportsDeleted = await deleteAllByField(
    databases,
    env.DATABASE_ID,
    env.REVIEW_REPORTS_COLLECTION_ID,
    "reportedByUserId",
    callerUserId,
    log,
    error,
    summary.errors,
    "reports",
  );

  // ── 3. Delete the users collection doc ──────────────────────────────────
  // The users collection uses an auto-generated $id with the auth user ID
  // stored in a `userId` attribute. We find the row by userId then delete.
  try {
    const usersResult = await databases.listDocuments(
      env.DATABASE_ID,
      env.USERS_COLLECTION_ID,
      [Query.equal("userId", callerUserId), Query.limit(1)],
    );
    const userDoc = usersResult.documents[0];
    if (userDoc) {
      await databases.deleteDocument(
        env.DATABASE_ID,
        env.USERS_COLLECTION_ID,
        userDoc.$id,
      );
      summary.userDocDeleted = true;
      log(`Users collection doc deleted (${userDoc.$id})`);
    } else {
      log(`No users collection doc found for ${callerUserId} — skipping`);
    }
  } catch (err) {
    error(`Users doc deletion failed: ${err.message}`);
    summary.errors.push(`userDoc: ${err.message}`);
  }

  // ── 4. Delete the auth account ──────────────────────────────────────────
  // CRITICAL: this is irreversible and kills all the user's sessions. If
  // it fails, surface a non-2xx so the client can retry. Everything above
  // is idempotent — retrying re-runs cleanly even if some steps succeeded.
  try {
    await users.delete(callerUserId);
    summary.authAccountDeleted = true;
    log(`Auth account deleted: ${callerUserId}`);
  } catch (err) {
    error(`Auth account deletion failed: ${err.message}`);
    summary.errors.push(`authAccount: ${err.message}`);
    return res.json(
      {
        success: false,
        error:
          "Account data was deleted but the auth account could not be removed. Contact support.",
        summary,
      },
      500,
    );
  }

  log(`Deletion complete for ${callerUserId}: ${JSON.stringify(summary)}`);
  return res.json({ success: true, summary });
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Page through all docs matching a userId field and reassign to the
 * sentinel. Returns count of reassigned docs.
 *
 * Each update is independent — if one fails, log and continue. Per-doc
 * permissions may not allow the function to update a doc it doesn't own;
 * but with the API key we bypass per-doc permissions, so this should
 * succeed for everything.
 */
async function reassignUserId(
  databases,
  databaseId,
  collectionId,
  oldUserId,
  newUserId,
  log,
) {
  let count = 0;
  let cursor = null;
  for (let safety = 0; safety < 1000; safety++) {
    const queries = [Query.equal("userId", oldUserId), Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const result = await databases.listDocuments(
      databaseId,
      collectionId,
      queries,
    );
    if (result.documents.length === 0) break;

    for (const doc of result.documents) {
      try {
        await databases.updateDocument(databaseId, collectionId, doc.$id, {
          userId: newUserId,
        });
        count++;
      } catch (err) {
        log(`Failed to reassign doc ${doc.$id}: ${err.message}`);
      }
    }

    if (result.documents.length < PAGE_SIZE) break;
    cursor = result.documents[result.documents.length - 1].$id;
  }
  log(`Reassigned ${count} docs in ${collectionId}`);
  return count;
}

/**
 * Page through all docs matching field=value and delete each. Returns
 * count of deleted docs. Continues on individual failures.
 *
 * Each collection has its own caller-facing error reporting — the calling
 * code passes a label so we can attribute failures.
 */
async function deleteAllByField(
  databases,
  databaseId,
  collectionId,
  fieldName,
  value,
  log,
  error,
  errors,
  label,
) {
  let count = 0;
  let cursor = null;
  try {
    for (let safety = 0; safety < 1000; safety++) {
      const queries = [Query.equal(fieldName, value), Query.limit(PAGE_SIZE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));

      const result = await databases.listDocuments(
        databaseId,
        collectionId,
        queries,
      );
      if (result.documents.length === 0) break;

      for (const doc of result.documents) {
        try {
          await databases.deleteDocument(databaseId, collectionId, doc.$id);
          count++;
        } catch (err) {
          log(`Failed to delete doc ${doc.$id} from ${label}: ${err.message}`);
        }
      }

      if (result.documents.length < PAGE_SIZE) break;
      cursor = result.documents[result.documents.length - 1].$id;
    }
    log(`Deleted ${count} docs from ${label}`);
  } catch (err) {
    error(`${label} cleanup failed: ${err.message}`);
    errors.push(`${label}: ${err.message}`);
  }
  return count;
}
