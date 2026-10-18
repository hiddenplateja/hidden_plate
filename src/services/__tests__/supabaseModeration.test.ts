import { supabase } from "@/services/supabase";
import { reportSupabaseReview, reportSupabaseComment, reportSupabasePost, reportSupabasePostComment,
  listSupabaseReports, listSupabaseCommentReports, listSupabasePostReports, listSupabasePostCommentReports,
  deleteSupabaseReport, hasSupabaseUserReported, moderateSupabaseContent } from "@/services/supabaseReports";
import { createSupabaseClaim, approveSupabaseClaim, rejectSupabaseClaim, listSupabaseClaims, countSupabasePendingClaims } from "@/services/supabaseClaims";
import { getSupabaseOwnerMenu, updateMySupabaseRestaurantMenu } from "@/services/supabaseRestaurantMenus";
import { submitSupabaseBugReport, listSupabaseBugReports, updateSupabaseBugReportStatus, deleteSupabaseBugReport } from "@/services/supabaseBugReports";
import { getSupabaseAdminStats } from "@/services/supabaseAdmin";
import type { RestaurantClaim } from "@/services/claims";

jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getUser: jest.fn() } } }));
// Preserve payload-only tests; real account/credential guards have a separate suite.
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase, async () => (await supabase.auth.getUser()).data.user?.id));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.2", nativeBuildVersion: "42" }));
jest.mock("expo-device", () => ({ modelName: "Android device", osName: "Android", osVersion: "15" }));
jest.mock("react-native", () => ({ Platform: { OS: "android", Version: 35 } }));
const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const getUser = supabase.auth.getUser as jest.Mock;
const id = "f8000000-0000-4000-8000-000000000001";
const other = "f8000000-0000-4000-8000-000000000002";
const third = "f8000000-0000-4000-8000-000000000003";
const report = { id, created_at: "2026-10-07", reported_by_user_id: other, reason: "spam", notes: null,
  review_id: third, restaurant_id: other, comment_id: third, post_id: other };
const claimRow = { id, restaurant_id: other, user_id: third, status: "pending", contact_name: "Owner",
  contact_phone: "8765551234", contact_email: "owner@example.test", claimant_role: "owner", proof_note: "Proof", created_at: "2026-10-07" };
beforeEach(() => { jest.resetAllMocks(); rpc.mockResolvedValue({ data: null, error: null }); });

test("reports send only the target; caller and parent IDs cannot be forged", async () => {
  await reportSupabaseReview(id, "forged", "spam", " note ");
  await reportSupabaseComment(id, "forged-review", "forged-restaurant");
  await reportSupabasePost(id);
  await reportSupabasePostComment(id, "forged-post");
  expect(rpc.mock.calls.map(c => c[1].report_kind)).toEqual(["review", "comment", "post", "post_comment"]);
  expect(rpc).toHaveBeenNthCalledWith(1, "submit_content_report", {
    report_kind: "review", target_id: id, report_reason: "spam", report_notes: "note",
  });
  for (const [, args] of rpc.mock.calls) expect(Object.keys(args).sort()).toEqual(["report_kind", "report_notes", "report_reason", "target_id"]);
});
test("invalid IDs fail before network; backend errors surface", async () => {
  await expect(reportSupabasePost("bad")).rejects.toThrow("Invalid content");
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: { message: "Account is banned" } });
  await expect(reportSupabasePost(id)).rejects.toThrow("Account is banned");
});
test("queue lookahead detects the exact last page and keeps camelCase fields", async () => {
  rpc.mockResolvedValue({ data: [report, { ...report, id: other }], error: null });
  const page = await listSupabaseReports({ pageSize: 1 });
  expect(page).toEqual({ items: [{ id, createdAt: report.created_at, reportedByUserId: other,
    reason: "spam", notes: null, reviewId: third, restaurantId: other }], nextCursor: id, hasMore: true });
  rpc.mockResolvedValue({ data: [report], error: null });
  expect((await listSupabaseReports({ pageSize: 1 })).hasMore).toBe(false);
  expect((await listSupabaseCommentReports()).items[0].commentId).toBe(third);
  expect((await listSupabasePostReports()).items[0].postId).toBe(other);
  expect((await listSupabasePostCommentReports()).items[0].postId).toBe(other);
  rpc.mockResolvedValue({ data: [], error: null });
  expect(await listSupabaseReports()).toEqual({ items: [], nextCursor: null, hasMore: false });
});
test("queue limits are bounded and malformed cursors rejected", async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  await listSupabaseReports({ pageSize: 2000, cursor: id });
  expect(rpc).toHaveBeenLastCalledWith("admin_queue_page", { queue_kind: "review", after_id: id, page_size: 100, filter_status: null });
  await expect(listSupabaseReports({ cursor: "id);delete" })).rejects.toThrow("Invalid queue cursor");
});
test("report dismissal and content moderation use separate admin-only RPCs", async () => {
  await deleteSupabaseReport(id); await moderateSupabaseContent("review", id, "restore");
  expect(rpc).toHaveBeenCalledWith("admin_dismiss_report", { queue_kind: "review", report_id: id });
  expect(rpc).toHaveBeenCalledWith("admin_moderate_content", { content_kind: "review", target_id: id, moderation_action: "restore" });
});
test("already-reported lookup is explicitly tied to the current user even for admins", async () => {
  const query = { select: jest.fn(), eq: jest.fn(), limit: jest.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.limit.mockResolvedValue({ data: [{ id }], error: null });
  from.mockReturnValue(query); getUser.mockResolvedValue({ data: { user: { id: other } }, error: null });
  expect(await hasSupabaseUserReported(id)).toBe(true);
  expect(query.eq).toHaveBeenCalledWith("reported_by_user_id", other);
  getUser.mockRejectedValue(new Error("Offline")); expect(await hasSupabaseUserReported(id)).toBe(false);
});
test("claim creation whitelists fields, normalizes contacts and maps the existing contract", async () => {
  rpc.mockResolvedValue({ data: [claimRow], error: null });
  const result = await createSupabaseClaim({ restaurantId: other, contactName: " Owner ", contactPhone: " 8765551234 ",
    contactEmail: " OWNER@EXAMPLE.TEST ", role: "owner", proofNote: " Proof ", userId: "forged", status: "approved" } as never);
  expect(rpc).toHaveBeenCalledWith("submit_restaurant_claim", { claim_payload: {
    restaurant_id: other, contact_name: "Owner", contact_phone: "8765551234", contact_email: "owner@example.test", claimant_role: "owner", proof_note: "Proof",
  } });
  expect(result).toMatchObject({ restaurantId: other, userId: third, contactName: "Owner", role: "owner", reviewedAt: null });
});
test("claim approval derives ownership from the stored ID, not the supplied object", async () => {
  const forged = { id, userId: "forged", restaurantId: "forged" } as RestaurantClaim;
  await approveSupabaseClaim(forged); await rejectSupabaseClaim(forged);
  expect(rpc).toHaveBeenNthCalledWith(1, "admin_review_claim", { claim_id: id, decision: "approved" });
  expect(rpc).toHaveBeenNthCalledWith(2, "admin_review_claim", { claim_id: id, decision: "rejected" });
  expect(from).not.toHaveBeenCalled();
});
test("claims queue is pending by default; failed count stays tolerant", async () => {
  rpc.mockResolvedValue({ data: [claimRow], error: null });
  expect((await listSupabaseClaims()).items[0].status).toBe("pending");
  expect(rpc).toHaveBeenCalledWith("admin_queue_page", { queue_kind: "claim", after_id: null, page_size: 25, filter_status: "pending" });
  rpc.mockResolvedValue({ data: null, error: { message: "Admin access required." } });
  expect(await countSupabasePendingClaims()).toBe(0);
});
test("owner menu saves through the verified-owner endpoint", async () => {
  const menu = [{ title: "Mains", items: ["Chicken"] }];
  await updateMySupabaseRestaurantMenu(id, menu);
  expect(rpc).toHaveBeenCalledWith("update_owner_restaurant_menu", { target_restaurant: id, menu_value: menu });
  const query = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.maybeSingle.mockResolvedValue({ data: { menu }, error: null });
  from.mockReturnValue(query); expect(await getSupabaseOwnerMenu(id)).toEqual(menu);
  query.maybeSingle.mockResolvedValue({ data: null, error: null }); expect(await getSupabaseOwnerMenu(id)).toBeNull();
});
test("bug reports preserve device summary, length limits and admin status contract", async () => {
  await submitSupabaseBugReport({ type: "bug", message: "x".repeat(2100) });
  expect(rpc).toHaveBeenCalledWith("submit_bug_report", { report_type: "bug", report_message: "x".repeat(2000),
    report_device_info: "Android device · Android 15 · app 1.2 (42)" });
  await expect(submitSupabaseBugReport({ type: "bug", message: " " })).rejects.toThrow("Please describe");
  rpc.mockResolvedValue({ data: [{ id, created_at: "now", user_id: other, type: "bug", message: "Bug", device_info: "Phone", status: "open" }], error: null });
  expect((await listSupabaseBugReports()).items[0]).toMatchObject({ deviceInfo: "Phone", userId: other, createdAt: "now" });
  await updateSupabaseBugReportStatus(id, "resolved"); await deleteSupabaseBugReport(id);
  expect(rpc).toHaveBeenCalledWith("admin_bug_report_status", { report_id: id, new_status: "resolved" });
  expect(rpc).toHaveBeenCalledWith("admin_dismiss_report", { queue_kind: "bug", report_id: id });
});
test("full admin dashboard includes every report count and fails closed", async () => {
  const stats = { restaurantsTotal: 4, restaurantsActive: 3, restaurantsPending: 1, reviews: 2, users: 3,
    reports: 1, commentReports: 2, postReports: 3, postCommentReports: 4, claims: 5 };
  rpc.mockResolvedValue({ data: stats, error: null }); expect(await getSupabaseAdminStats()).toEqual(stats);
  rpc.mockResolvedValue({ data: null, error: { message: "Admin access required." } });
  await expect(getSupabaseAdminStats()).rejects.toThrow("Admin access required.");
});
