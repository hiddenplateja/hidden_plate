// src/services/reports.ts
// Report a review for inappropriate content.
//
// Design:
//   - One report per (userId, reviewId) — enforced by unique compound
//     index user_review_idx on (reviewId, reportedByUserId).
//   - After a successful report, we call the send-notification Function in
//     moderation mode. That function counts reports against the threshold
//     and auto-hides the review (sets isHidden=true) when reached.
//     The hide step needs server-side privileges since users can't
//     update other people's reviews.
//   - The auto-hide is silent from the reporter's perspective — they don't
//     see whether their report was "the one" that hit the threshold.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import {
  account,
  appwriteConfig,
  databases,
  functions,
} from "@/services/appwrite";

export type ReportReason = "inappropriate" | "spam" | "fake" | "other";

export class ReportError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

/**
 * Report a review. Idempotent — if the user already reported this review,
 * the unique index causes Appwrite to error; we swallow it and return.
 *
 * On success, fires a server-side moderation check. The function will
 * auto-hide the review if the report threshold is met. Fire-and-forget;
 * if it fails the report is still recorded for manual admin review.
 */
export async function reportReview(
  reviewId: string,
  restaurantId: string,
  reason: ReportReason = "inappropriate",
  notes?: string,
): Promise<void> {
  let me;
  try {
    me = await account.get();
  } catch {
    throw new ReportError("You must be signed in to report content.");
  }

  let wasNew = true;
  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewReports,
      ID.unique(),
      {
        reviewId,
        reportedByUserId: me.$id,
        restaurantId,
        reason,
        notes: notes ?? null,
      },
      [
        // The reporter can read their own report row. Update/delete are
        // intentionally not granted — once filed, the user can't retract.
        Permission.read(Role.user(me.$id)),
      ],
    );
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Unique compound index violation = this user already reported this
      // review. The correct Appwrite error code is 409 / type
      // "document_already_exists". Treat as a no-op success so the UX
      // doesn't show an error if the user taps Report twice.
      if (err.code === 409 || err.type === "document_already_exists") {
        wasNew = false;
      } else {
        throw new ReportError(err.message || "Failed to submit report.");
      }
    } else {
      throw new ReportError("Failed to submit report.");
    }
  }

  // Only fire the moderation check if a NEW report was created. Duplicate
  // reports don't change the count, so re-checking is wasted work.
  if (wasNew) {
    // Fire-and-forget. The reporter doesn't need confirmation that the
    // threshold was hit; they just need to know their report was filed.
    fireModerationCheck(reviewId).catch((err) => {
      console.warn("[reports] moderation check failed:", err);
    });
  }
}

/**
 * Has the current user already reported this review?
 * Used to decide whether to show "Report" or "Already reported".
 */
export async function hasUserReported(reviewId: string): Promise<boolean> {
  let me;
  try {
    me = await account.get();
  } catch {
    return false;
  }
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewReports,
      [
        Query.equal("reviewId", reviewId),
        Query.equal("reportedByUserId", me.$id),
        Query.limit(1),
      ],
    );
    return res.documents.length > 0;
  } catch {
    return false;
  }
}

// ─── Admin: reports queue ────────────────────────────────────────────────────
// Reading/deleting other users' reports relies on the admins team having
// collection-level Read/Delete on reviewReports (granted in the console).
// With document security on, a collection-level grant works alongside the
// per-doc reporter grant.

export interface ReviewReport {
  id: string;
  createdAt: string;
  reviewId: string;
  restaurantId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

interface ReportDoc {
  $id: string;
  $createdAt: string;
  reviewId: string;
  restaurantId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

function mapReport(doc: ReportDoc): ReviewReport {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    reviewId: doc.reviewId,
    restaurantId: doc.restaurantId,
    reportedByUserId: doc.reportedByUserId,
    reason: doc.reason,
    notes: doc.notes ?? null,
  };
}

/** List filed reports, newest first. Admin-only (collection read perm). */
export async function listReports(
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<{ items: ReviewReport[]; nextCursor: string | null; hasMore: boolean }> {
  const { cursor, pageSize = 50 } = opts;
  const queries: string[] = [
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewReports,
      queries,
    );
    const items = (res.documents as unknown as ReportDoc[]).map(mapReport);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      nextCursor: lastId,
      hasMore: items.length === pageSize,
    };
  } catch (err) {
    throw new ReportError(
      err instanceof AppwriteException
        ? err.message
        : "Failed to load reports.",
    );
  }
}

/** Dismiss (delete) a single report row. Admin-only. */
export async function deleteReport(reportId: string): Promise<void> {
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.reviewReports,
      reportId,
    );
  } catch (err) {
    throw new ReportError(
      err instanceof AppwriteException
        ? err.message
        : "Couldn't dismiss report.",
    );
  }
}

// ─── Function invocation ───────────────────────────────────────────────────

/**
 * Ask the send-notification function to check whether this review has hit
 * the auto-hide threshold and, if so, set isHidden=true.
 *
 * Runs server-side with an API key, so it can update reviews the current
 * user doesn't own.
 */
async function fireModerationCheck(reviewId: string): Promise<void> {
  try {
    await functions.createExecution({
      functionId: appwriteConfig.functions.sendNotification,
      body: JSON.stringify({
        moderation: true,
        reviewId,
      }),
      async: false, // don't block on response
    });
  } catch (err) {
    throw err;
  }
}
