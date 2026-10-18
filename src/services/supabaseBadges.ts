import { currentSupabaseSessionIdentity, pinSupabaseSession } from "@/services/supabasePinnedSession";
import { getReviewerBadges, type ReviewerBadge, type ReviewerBadgeStats } from "@/utils/reviewerBadges";
import { mergeSupabasePreferences } from "@/services/supabaseUserPreferences";
import { withRequestTimeout } from "@/utils/withRequestTimeout";

// Serialize within this app instance; cross-device celebration dedupe is not
// claimed. Reads/writes remain pinned to the account that requested the sync.
let badgeQueue: Promise<void> = Promise.resolve();
export async function syncSupabaseEarnedBadges(stats: ReviewerBadgeStats): Promise<ReviewerBadge[]> {
  const expected = await currentSupabaseSessionIdentity().catch(() => null);
  if (!expected) return [];
  const result = badgeQueue.catch(() => {}).then(async () => {
    const pinned = await pinSupabaseSession(expected);
    if (!pinned) return [];
    const { data, error } = await withRequestTimeout(5000, signal => pinned.client.from("profiles").select("preferences").eq("id", pinned.userId)
      .setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal).single());
    if (error || !data) return [];
    const earned = getReviewerBadges(stats);
    const earnedIds = earned.map(badge => badge.id);
    const seen = mergeSupabasePreferences(data.preferences ?? {}).seenBadgeIds;
    const newly = seen === null ? [] : earned.filter(badge => !seen.includes(badge.id));
    if (seen !== null && !newly.length) return [];
    const current = await currentSupabaseSessionIdentity();
    if (current?.userId !== expected.userId || current.accessToken !== expected.accessToken) return [];
    const { error: writeError } = await withRequestTimeout(5000, signal => pinned.client.rpc("merge_my_preferences", { preference_patch: {
      seenBadgeIds: Array.from(new Set([...(seen ?? []), ...earnedIds])),
    } }).setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal));
    if (writeError) return [];
    const after = await currentSupabaseSessionIdentity();
    return after?.userId === expected.userId && after.accessToken === expected.accessToken ? newly : [];
  }).catch(() => []);
  badgeQueue = result.then(() => {});
  return result;
}
