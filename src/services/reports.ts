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

/** Whether comment reporting is available (collection configured). */
export function commentReportsEnabled(): boolean {
  return !!appwriteConfig.collections.commentReports;
}

/**
 * Report a review comment. Files into the dedicated comment_reports collection
 * so moderators can review it (no auto-hide threshold — comments are reviewed
 * manually). Idempotent: a unique (commentId, reportedByUserId) index makes a
 * repeat report a no-op success.
 */
export async function reportComment(
  commentId: string,
  reviewId: string,
  restaurantId: string,
  reason: ReportReason = "inappropriate",
  notes?: string,
): Promise<void> {
  const collection = appwriteConfig.collections.commentReports;
  if (!collection) {
    throw new ReportError("Reporting isn't available right now.");
  }

  let me;
  try {
    me = await account.get();
  } catch {
    throw new ReportError("You must be signed in to report content.");
  }

  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      collection,
      ID.unique(),
      {
        commentId,
        reviewId,
        restaurantId,
        reportedByUserId: me.$id,
        reason,
        notes: notes ?? null,
      },
      [Permission.read(Role.user(me.$id))],
    );
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Already reported by this user — treat as success (see reportReview).
      if (err.code === 409 || err.type === "document_already_exists") {
        return;
      }
      throw new ReportError(err.message || "Failed to submit report.");
    }
    throw new ReportError("Failed to submit report.");
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

// ─── Admin: comment reports queue ────────────────────────────────────────────
// Same access model as reviewReports: the admins team has collection-level
// Read/Delete on comment_reports (granted in the console), alongside the per-doc
// reporter read grant from reportComment().

export interface CommentReport {
  id: string;
  createdAt: string;
  commentId: string;
  reviewId: string;
  restaurantId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

interface CommentReportDoc {
  $id: string;
  $createdAt: string;
  commentId: string;
  reviewId: string;
  restaurantId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

function mapCommentReport(doc: CommentReportDoc): CommentReport {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    commentId: doc.commentId,
    reviewId: doc.reviewId,
    restaurantId: doc.restaurantId,
    reportedByUserId: doc.reportedByUserId,
    reason: doc.reason,
    notes: doc.notes ?? null,
  };
}

/** List filed comment reports, newest first. Admin-only (collection read perm). */
export async function listCommentReports(
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<{
  items: CommentReport[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const collection = appwriteConfig.collections.commentReports;
  if (!collection) return { items: [], nextCursor: null, hasMore: false };

  const { cursor, pageSize = 50 } = opts;
  const queries: string[] = [
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      queries,
    );
    const items = (res.documents as unknown as CommentReportDoc[]).map(
      mapCommentReport,
    );
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
        : "Failed to load comment reports.",
    );
  }
}

/** Dismiss (delete) a single comment report row. Admin-only. */
export async function deleteCommentReport(reportId: string): Promise<void> {
  const collection = appwriteConfig.collections.commentReports;
  if (!collection) return;
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      collection,
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

// ─── Community post reports ──────────────────────────────────────────────────
// Same model as comment reports: file into a dedicated post_reports collection
// for manual admin review (no auto-hide — posts are owner-only writable). A
// unique (postId, reportedByUserId) index makes a repeat report a no-op success.

/** Whether post reporting is available (collection configured). */
export function postReportsEnabled(): boolean {
  return !!appwriteConfig.collections.postReports;
}

/**
 * Report a community post. Idempotent: a repeat report by the same user is a
 * silent no-op (unique index). Filed for manual admin review.
 */
export async function reportPost(
  postId: string,
  reason: ReportReason = "inappropriate",
  notes?: string,
): Promise<void> {
  const collection = appwriteConfig.collections.postReports;
  if (!collection) {
    throw new ReportError("Reporting isn't available right now.");
  }

  let me;
  try {
    me = await account.get();
  } catch {
    throw new ReportError("You must be signed in to report content.");
  }

  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      collection,
      ID.unique(),
      {
        postId,
        reportedByUserId: me.$id,
        reason,
        notes: notes ?? null,
      },
      [Permission.read(Role.user(me.$id))],
    );
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Already reported by this user — treat as success (see reportReview).
      if (err.code === 409 || err.type === "document_already_exists") {
        return;
      }
      throw new ReportError(err.message || "Failed to submit report.");
    }
    throw new ReportError("Failed to submit report.");
  }
}

export interface PostReport {
  id: string;
  createdAt: string;
  postId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

interface PostReportDoc {
  $id: string;
  $createdAt: string;
  postId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

function mapPostReport(doc: PostReportDoc): PostReport {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    postId: doc.postId,
    reportedByUserId: doc.reportedByUserId,
    reason: doc.reason,
    notes: doc.notes ?? null,
  };
}

/** List filed post reports, newest first. Admin-only (collection read perm). */
export async function listPostReports(
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<{ items: PostReport[]; nextCursor: string | null; hasMore: boolean }> {
  const collection = appwriteConfig.collections.postReports;
  if (!collection) return { items: [], nextCursor: null, hasMore: false };

  const { cursor, pageSize = 50 } = opts;
  const queries: string[] = [
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      queries,
    );
    const items = (res.documents as unknown as PostReportDoc[]).map(
      mapPostReport,
    );
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      nextCursor: lastId,
      hasMore: items.length === pageSize,
    };
  } catch (err) {
    throw new ReportError(
      err instanceof AppwriteException ? err.message : "Failed to load reports.",
    );
  }
}

/** Dismiss (delete) a single post report row. Admin-only. */
export async function deletePostReport(reportId: string): Promise<void> {
  const collection = appwriteConfig.collections.postReports;
  if (!collection) return;
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      collection,
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

// ─── Community post-comment reports ──────────────────────────────────────────
// Same model as review-comment reports, for comments on community posts. Manual
// admin review; a unique (commentId, reportedByUserId) index dedupes.

/** Whether post-comment reporting is available (collection configured). */
export function postCommentReportsEnabled(): boolean {
  return !!appwriteConfig.collections.postCommentReports;
}

/**
 * Report a comment on a community post. Idempotent: a repeat report by the same
 * user is a silent no-op. `postId` is stored so the admin queue can link back.
 */
export async function reportPostComment(
  commentId: string,
  postId: string,
  reason: ReportReason = "inappropriate",
  notes?: string,
): Promise<void> {
  const collection = appwriteConfig.collections.postCommentReports;
  if (!collection) {
    throw new ReportError("Reporting isn't available right now.");
  }

  let me;
  try {
    me = await account.get();
  } catch {
    throw new ReportError("You must be signed in to report content.");
  }

  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      collection,
      ID.unique(),
      {
        commentId,
        postId,
        reportedByUserId: me.$id,
        reason,
        notes: notes ?? null,
      },
      [Permission.read(Role.user(me.$id))],
    );
  } catch (err) {
    if (err instanceof AppwriteException) {
      if (err.code === 409 || err.type === "document_already_exists") {
        return;
      }
      throw new ReportError(err.message || "Failed to submit report.");
    }
    throw new ReportError("Failed to submit report.");
  }
}

export interface PostCommentReport {
  id: string;
  createdAt: string;
  commentId: string;
  postId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

interface PostCommentReportDoc {
  $id: string;
  $createdAt: string;
  commentId: string;
  postId: string;
  reportedByUserId: string;
  reason: ReportReason;
  notes: string | null;
}

function mapPostCommentReport(doc: PostCommentReportDoc): PostCommentReport {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    commentId: doc.commentId,
    postId: doc.postId,
    reportedByUserId: doc.reportedByUserId,
    reason: doc.reason,
    notes: doc.notes ?? null,
  };
}

/** List filed post-comment reports, newest first. Admin-only. */
export async function listPostCommentReports(
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<{
  items: PostCommentReport[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const collection = appwriteConfig.collections.postCommentReports;
  if (!collection) return { items: [], nextCursor: null, hasMore: false };

  const { cursor, pageSize = 50 } = opts;
  const queries: string[] = [
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      queries,
    );
    const items = (res.documents as unknown as PostCommentReportDoc[]).map(
      mapPostCommentReport,
    );
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      nextCursor: lastId,
      hasMore: items.length === pageSize,
    };
  } catch (err) {
    throw new ReportError(
      err instanceof AppwriteException ? err.message : "Failed to load reports.",
    );
  }
}

/** Dismiss (delete) a single post-comment report row. Admin-only. */
export async function deletePostCommentReport(reportId: string): Promise<void> {
  const collection = appwriteConfig.collections.postCommentReports;
  if (!collection) return;
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      collection,
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
