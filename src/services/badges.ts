// src/services/badges.ts
// Glue between reviewer-badge logic (pure) and the persisted "seen badges" set
// (account prefs). Used after a review is posted to detect a freshly-crossed
// tier so the UI can celebrate it.

import {
  getUserPreferences,
  updateUserPreferences,
} from "@/services/userPreferences";
import {
  getReviewerBadges,
  type ReviewerBadge,
  type ReviewerBadgeStats,
} from "@/utils/reviewerBadges";

/**
 * Reconcile the user's earned badges with the "already celebrated" set in prefs
 * and return the ones that are NEW (so the caller can celebrate them).
 *
 * Baseline rule: if the seen-set was never initialized (`null`) — i.e. an
 * existing user from before this feature — we silently seed it to their current
 * badges and return nothing, so they aren't congratulated retroactively. New
 * users start with an empty set (seeded at onboarding), so their first earned
 * badge IS celebrated.
 *
 * Tolerant: any prefs failure returns [] (no celebration) rather than throwing —
 * a missed celebration must never break posting a review.
 */
export async function syncEarnedBadges(
  stats: ReviewerBadgeStats,
): Promise<ReviewerBadge[]> {
  const earned = getReviewerBadges(stats);
  const earnedIds = earned.map((b) => b.id);

  let seen: string[] | null;
  try {
    seen = (await getUserPreferences()).seenBadgeIds;
  } catch {
    return [];
  }

  // First-ever sync for this account → baseline silently.
  if (seen === null) {
    await updateUserPreferences({ seenBadgeIds: earnedIds }).catch(() => {});
    return [];
  }

  const newly = earned.filter((b) => !seen.includes(b.id));
  if (newly.length > 0) {
    const union = Array.from(new Set([...seen, ...earnedIds]));
    await updateUserPreferences({ seenBadgeIds: union }).catch(() => {});
  }
  return newly;
}
