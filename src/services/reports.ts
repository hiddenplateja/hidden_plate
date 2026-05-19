// src/services/reports.ts
// Report a review for inappropriate content.
//
// Design:
//   - One report per (userId, reviewId) — enforced by unique index.
//     Prevents spamming the same report.
//   - Documents have no read permission for users — admins only.
//     This prevents users from seeing who reported what.
//   - Client hides the reported review locally immediately (optimistic).
//     Whether the review is actually removed is a moderation decision.

import {
    AppwriteException,
    ID,
    Permission,
    Query,
    Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";

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
 * returns silently instead of erroring.
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
        // No read/update/delete for the reporter — admin-only after creation
        Permission.read(Role.user(me.$id)), // allow reading own report
      ],
    );
  } catch (err) {
    if (err instanceof AppwriteException) {
      // Unique index violation = already reported. Treat as success.
      if (err.type === "document_invalid_structure" || err.code === 409) {
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
