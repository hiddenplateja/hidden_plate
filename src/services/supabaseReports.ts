// Keep the live report contracts; parent IDs and reporter identity are derived
// by Postgres, never trusted from a screen or a modified client.
import { requireSupabaseDataSession, restForSupabaseDataSession } from "@/services/supabaseDataRequest";
import { dismissSupabaseReport, supabaseCommand, supabaseQueuePage, SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import type { QueueOptions } from "@/services/supabaseAdminQueue";
import type { CommentReport, PostCommentReport, PostReport, ReportReason, ReviewReport } from "@/services/reports";

type Kind = "review" | "comment" | "post" | "post_comment";
type ReportRow = {
  id: string; created_at: string; reported_by_user_id: string; reason: ReportReason; notes: string | null;
  review_id: string; restaurant_id: string; post_id: string; comment_id: string;
};
function base(row: ReportRow) {
  return { id: row.id, createdAt: row.created_at, reportedByUserId: row.reported_by_user_id, reason: row.reason, notes: row.notes ?? null };
}
async function submit(kind: Kind, target: string, reason: ReportReason, notes?: string) {
  if (!SUPABASE_UUID.test(target)) throw new Error("Invalid content ID.");
  await supabaseCommand("submit_content_report", {
    report_kind: kind, target_id: target, report_reason: reason, report_notes: notes?.trim() || null,
  });
}
export function reportSupabaseReview(reviewId: string, _restaurantId: string, reason: ReportReason = "inappropriate", notes?: string) {
  return submit("review", reviewId, reason, notes);
}
export function reportSupabaseComment(commentId: string, _reviewId: string, _restaurantId: string, reason: ReportReason = "inappropriate", notes?: string) {
  return submit("comment", commentId, reason, notes);
}
export function reportSupabasePost(postId: string, reason: ReportReason = "inappropriate", notes?: string) {
  return submit("post", postId, reason, notes);
}
export function reportSupabasePostComment(commentId: string, _postId: string, reason: ReportReason = "inappropriate", notes?: string) {
  return submit("post_comment", commentId, reason, notes);
}
export async function hasSupabaseUserReported(reviewId: string): Promise<boolean> {
  if (!SUPABASE_UUID.test(reviewId)) return false;
  try {
    const pinned = await requireSupabaseDataSession();
    const { data, error } = await restForSupabaseDataSession(pinned, client => client.from("review_reports").select("id").eq("review_id", reviewId)
      .eq("reported_by_user_id", pinned.userId).limit(1));
    return !error && !!data?.length;
  } catch { return false; }
}
export const listSupabaseReports = (opts: QueueOptions = {}) => supabaseQueuePage<ReportRow, ReviewReport>("review",
  r => ({ ...base(r), reviewId: r.review_id, restaurantId: r.restaurant_id }), opts);
export const listSupabaseCommentReports = (opts: QueueOptions = {}) => supabaseQueuePage<ReportRow, CommentReport>("comment",
  r => ({ ...base(r), commentId: r.comment_id, reviewId: r.review_id, restaurantId: r.restaurant_id }), opts);
export const listSupabasePostReports = (opts: QueueOptions = {}) => supabaseQueuePage<ReportRow, PostReport>("post",
  r => ({ ...base(r), postId: r.post_id }), opts);
export const listSupabasePostCommentReports = (opts: QueueOptions = {}) => supabaseQueuePage<ReportRow, PostCommentReport>("post_comment",
  r => ({ ...base(r), commentId: r.comment_id, postId: r.post_id }), opts);
export const deleteSupabaseReport = (id: string) => dismissSupabaseReport("review", id);
export const deleteSupabaseCommentReport = (id: string) => dismissSupabaseReport("comment", id);
export const deleteSupabasePostReport = (id: string) => dismissSupabaseReport("post", id);
export const deleteSupabasePostCommentReport = (id: string) => dismissSupabaseReport("post_comment", id);
export async function moderateSupabaseContent(kind: Kind, id: string, action: "hide" | "restore" | "delete") {
  if (!SUPABASE_UUID.test(id)) throw new Error("Invalid content ID.");
  await supabaseCommand("admin_moderate_content", { content_kind: kind, target_id: id, moderation_action: action });
}
