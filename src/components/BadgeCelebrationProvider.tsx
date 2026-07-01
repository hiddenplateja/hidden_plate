// src/components/BadgeCelebrationProvider.tsx
// Catches reputation badges earned outside the write-review screen — e.g. a
// sync that failed at post time, or a review written on another device — and
// celebrates them the next time the app is opened/foregrounded.
//
// It complements (doesn't duplicate) the review-screen celebration: both call
// syncEarnedBadges, which persists the "seen" set in prefs, so a badge is only
// ever celebrated once across screens and devices.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { BadgeEarnedModal } from "@/components/BadgeEarnedModal";
import { useAuth } from "@/hooks/useAuth";
import { syncEarnedBadges } from "@/services/badges";
import { getUserReviewStats } from "@/services/reviews";
import type { ReviewerBadge } from "@/utils/reviewerBadges";

export function BadgeCelebrationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id;
  const [pending, setPending] = useState<ReviewerBadge[] | null>(null);
  const checking = useRef(false);

  const runCheck = useCallback(async () => {
    if (!userId || checking.current) return;
    checking.current = true;
    try {
      const stats = await getUserReviewStats(userId);
      const newly = await syncEarnedBadges(stats);
      // Don't clobber an already-open celebration.
      if (newly.length > 0) setPending((prev) => prev ?? newly);
    } catch {
      // best-effort — a missed celebration is never worth surfacing an error
    } finally {
      checking.current = false;
    }
  }, [userId]);

  // Once the signed-in user is known (app start / login).
  useEffect(() => {
    if (isAuthenticated && userId) runCheck();
  }, [isAuthenticated, userId, runCheck]);

  // On returning to the foreground — catches badges earned while away.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => sub.remove();
  }, [runCheck]);

  return (
    <>
      {children}
      {pending ? (
        <BadgeEarnedModal badges={pending} onClose={() => setPending(null)} />
      ) : null}
    </>
  );
}
