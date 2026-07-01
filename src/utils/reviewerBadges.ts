// src/utils/reviewerBadges.ts
// Pure: derive a user's "reputation" badges from review stats the profile
// already computes (reviewCount + parishesVisited) — so no extra queries.
// Returns the highest tier earned in each track (volume + parish coverage),
// plus the NEXT tier the user is working toward (for a progress nudge).

// Color family per badge — lets the UI distinguish tiers at a glance instead of
// painting every badge the same brand color. Mapped to real colors by the
// consumer (keeps this module theme-agnostic and pure).
export type BadgeTone = "gold" | "amber" | "coral" | "teal" | "blue" | "green";

export interface ReviewerBadge {
  id: string;
  label: string;
  icon: string; // MaterialCommunityIcons glyph name (consumer casts)
  tone: BadgeTone;
  /** Human-readable threshold, e.g. "25+ reviews" — tells users what it means. */
  requirement: string;
}

export interface ReviewerBadgeStats {
  reviewCount: number;
  parishesVisited: number;
}

interface Tier {
  min: number;
  badge: ReviewerBadge;
}

// Review-volume tiers, highest first. Entry tier at 1 so a first review is
// recognized; higher tiers are the aspirational ones. Tune freely.
const REVIEW_TIERS: Tier[] = [
  {
    min: 25,
    badge: {
      id: "local-expert",
      label: "Local Expert",
      icon: "crown",
      tone: "gold",
      requirement: "25+ reviews",
    },
  },
  {
    min: 10,
    badge: {
      id: "top-reviewer",
      label: "Top Reviewer",
      icon: "trophy",
      tone: "amber",
      requirement: "10+ reviews",
    },
  },
  {
    min: 1,
    badge: {
      id: "reviewer",
      label: "Reviewer",
      icon: "star-circle",
      tone: "coral",
      requirement: "1+ reviews",
    },
  },
];

// Parish-coverage tiers, highest first. Jamaica has 14 parishes.
const PARISH_TIERS: Tier[] = [
  {
    min: 14,
    badge: {
      id: "island-master",
      label: "Island Master",
      icon: "map-check",
      tone: "teal",
      requirement: "All 14 parishes",
    },
  },
  {
    min: 7,
    badge: {
      id: "island-explorer",
      label: "Island Explorer",
      icon: "map-marker-multiple",
      tone: "blue",
      requirement: "7+ parishes",
    },
  },
  {
    min: 3,
    badge: {
      id: "parish-explorer",
      label: "Parish Explorer",
      icon: "compass-outline",
      tone: "green",
      requirement: "3+ parishes",
    },
  },
];

function highestTier(tiers: Tier[], value: number): ReviewerBadge | null {
  for (const t of tiers) if (value >= t.min) return t.badge;
  return null;
}

/**
 * Earned badges for a user — the highest tier per track (review volume + parish
 * coverage). Empty when nothing qualifies (e.g. zero reviews).
 */
export function getReviewerBadges(stats: ReviewerBadgeStats): ReviewerBadge[] {
  const badges: ReviewerBadge[] = [];
  const review = highestTier(REVIEW_TIERS, stats.reviewCount);
  if (review) badges.push(review);
  const parish = highestTier(PARISH_TIERS, stats.parishesVisited);
  if (parish) badges.push(parish);
  return badges;
}

export interface BadgeProgress {
  /** The next badge to earn on this track. */
  badge: ReviewerBadge;
  current: number;
  target: number;
  remaining: number;
  /** Singular unit, e.g. "review" / "parish" — the UI pluralizes. */
  unit: string;
}

// Lowest tier whose threshold is still ahead of `value` = the next to earn.
function nextTier(tiers: Tier[], value: number): Tier | null {
  // tiers are highest-first; ascending makes "first unmet" easy to find.
  const ascending = [...tiers].reverse();
  for (const t of ascending) if (value < t.min) return t;
  return null;
}

/**
 * The next badge the user is working toward on each track they've STARTED
 * (value > 0). Empty for tracks that are maxed out or not yet begun — so a
 * brand-new profile stays clean while an active reviewer sees what's next.
 */
export function getNextBadgeProgress(
  stats: ReviewerBadgeStats,
): BadgeProgress[] {
  const out: BadgeProgress[] = [];

  const review = nextTier(REVIEW_TIERS, stats.reviewCount);
  if (review && stats.reviewCount > 0) {
    out.push({
      badge: review.badge,
      current: stats.reviewCount,
      target: review.min,
      remaining: review.min - stats.reviewCount,
      unit: "review",
    });
  }

  const parish = nextTier(PARISH_TIERS, stats.parishesVisited);
  if (parish && stats.parishesVisited > 0) {
    out.push({
      badge: parish.badge,
      current: stats.parishesVisited,
      target: parish.min,
      remaining: parish.min - stats.parishesVisited,
      unit: "parish",
    });
  }

  return out;
}

// ---------- Full ladder (for the "how badges work" guide) ----------

export interface LadderTier {
  badge: ReviewerBadge;
  min: number;
  /** The user already qualifies for this tier. */
  earned: boolean;
  /** The highest tier the user has earned on this track (their current rank). */
  isCurrent: boolean;
}

export interface BadgeLadderTrack {
  id: "reviews" | "parishes";
  title: string;
  /** Singular unit — the UI pluralizes. */
  unit: string;
  /** The user's current count on this track. */
  value: number;
  /** Tiers in ascending (entry → top) order for display. */
  tiers: LadderTier[];
}

function buildLadder(tiers: Tier[], value: number): LadderTier[] {
  // tiers are highest-first, so the first one the value clears is the current
  // (highest earned) rank.
  let currentMin = -1;
  for (const t of tiers) {
    if (value >= t.min) {
      currentMin = t.min;
      break;
    }
  }
  return [...tiers].reverse().map((t) => ({
    badge: t.badge,
    min: t.min,
    earned: value >= t.min,
    isCurrent: t.min === currentMin,
  }));
}

/**
 * Every tier on both tracks with the user's earned/current state — powers the
 * tap-to-learn guide so users can see the full ladder and what's left to earn.
 */
export function getBadgeLadder(stats: ReviewerBadgeStats): BadgeLadderTrack[] {
  return [
    {
      id: "reviews",
      title: "Reviews written",
      unit: "review",
      value: stats.reviewCount,
      tiers: buildLadder(REVIEW_TIERS, stats.reviewCount),
    },
    {
      id: "parishes",
      title: "Parishes explored",
      unit: "parish",
      value: stats.parishesVisited,
      tiers: buildLadder(PARISH_TIERS, stats.parishesVisited),
    },
  ];
}
