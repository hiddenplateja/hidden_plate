import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { deleteMySupabaseAccount } from "@/services/supabaseAccountDeletion";
import { mapSupabaseReview } from "@/services/supabaseReviews";
import { mapSupabasePost } from "@/services/supabasePosts";
import { listSupabaseComments, listSupabaseCommentsForPost } from "@/services/supabaseSocial";
jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn(), auth: { getSession: jest.fn(), signOut: jest.fn() } }, createIsolatedSupabaseAuthClient: jest.fn() }));
// Only the preserved-content read contracts use these mocked data helpers.
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase));
const getSession = supabase.auth.getSession as jest.Mock;
const signOut = supabase.auth.signOut as jest.Mock;
const isolated = createIsolatedSupabaseAuthClient as jest.Mock;
const proof = jest.fn(), invoke = jest.fn();
const session = { user: { id: "caller" }, access_token: "original-token", refresh_token: "never-copy-this" };
const summary = { reviewsAnonymized: 3, commentsAnonymized: 2, likesDeleted: 4, savedDeleted: 5, followsDeleted: 6, notificationsDeleted: 7, pushTokensDeleted: 1, reportsDeleted: 0, userDocDeleted: true, authAccountDeleted: true, errors: [] };
beforeEach(() => {
  jest.resetAllMocks(); getSession.mockResolvedValue({ data: { session } });
  isolated.mockReturnValue({ auth: { getUser: proof }, functions: { invoke } });
  proof.mockResolvedValue({ data: { user: { id: "caller" } } });
  invoke.mockResolvedValue({ data: { success: true, summary } }); signOut.mockResolvedValue({ error: null });
});
test("pins caller JWT, sends no target ID and locally signs out after confirmed deletion", async () => {
  expect(await deleteMySupabaseAccount()).toEqual(summary);
  expect(proof).toHaveBeenCalledWith("original-token");
  expect(invoke).toHaveBeenCalledWith("delete-account", { body: {}, headers: { Authorization: "Bearer original-token" } });
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
});
test("missing/invalid sessions never invoke deletion", async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  await expect(deleteMySupabaseAccount()).rejects.toThrow("Sign in"); expect(isolated).not.toHaveBeenCalled();
});
test("proof mismatch/invalid server session never deletes", async () => {
  proof.mockResolvedValue({ data: { user: { id: "someone-else" } } });
  await expect(deleteMySupabaseAccount()).rejects.toThrow("session changed"); expect(invoke).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
});
test("switching accounts before request stops deletion", async () => {
  getSession.mockResolvedValueOnce({ data: { session } }).mockResolvedValue({ data: { session: { user: { id: "new-user" } } } });
  await expect(deleteMySupabaseAccount()).rejects.toThrow("session changed"); expect(invoke).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
});
test("switching while request runs does not sign out the new account", async () => {
  invoke.mockImplementation(async () => { getSession.mockResolvedValue({ data: { session: { user: { id: "new-user" } } } }); return { data: { success: true, summary } }; });
  expect(await deleteMySupabaseAccount()).toEqual(summary); expect(signOut).not.toHaveBeenCalled();
});
test("partial server deletion is surfaced without silently revoking the current session", async () => {
  invoke.mockResolvedValue({ error: { context: { json: async () => ({ error: "Login deletion needs retry." }) } } });
  await expect(deleteMySupabaseAccount()).rejects.toThrow("Login deletion needs retry"); expect(signOut).not.toHaveBeenCalled();
});
test("malformed success/missing Auth confirmation does not claim completion", async () => {
  invoke.mockResolvedValue({ data: { success: true, summary: { ...summary, authAccountDeleted: false } } });
  await expect(deleteMySupabaseAccount()).rejects.toThrow("Unexpected deletion response"); expect(signOut).not.toHaveBeenCalled();
  invoke.mockResolvedValue({ data: { success: true, summary: { ...summary, likesDeleted: -1 } } });
  await expect(deleteMySupabaseAccount()).rejects.toThrow("Unexpected deletion response");
});
test("transport errors expose a safe uncertain result, never raw tokens/errors", async () => {
  invoke.mockRejectedValue(new Error("private debug token"));
  await expect(deleteMySupabaseAccount()).rejects.toThrow("could not be confirmed"); expect(signOut).not.toHaveBeenCalled();
});
test("local signout failure does not misreport confirmed server deletion", async () => {
  signOut.mockResolvedValue({ error: new Error("local failure") });
  const result = await deleteMySupabaseAccount(); expect(result.authAccountDeleted).toBe(true); expect(result.errors).toEqual(["Account deleted. Local session cleanup needs an app restart."]); expect(summary.errors).toEqual([]);
});
test("anonymized reviews/posts preserve existing Deleted user screen contract", () => {
  expect(mapSupabaseReview({ id: "review", user_id: null } as Parameters<typeof mapSupabaseReview>[0]).userId).toBe("deleted_user");
  expect(mapSupabasePost({ id: "post", user_id: null, image_paths: [], created_at: "joined", text: "Kept" }).userId).toBe("deleted_user");
});
test("anonymized review comments preserve restaurant/parent/text fields", async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: { items: [{ id: "comment", review_id: "review", restaurant_id: "restaurant", user_id: null, created_at: "posted", text: "Kept" }], total: 1 } });
  expect((await listSupabaseComments("review")).items[0]).toMatchObject({ userId: "deleted_user", reviewId: "review", restaurantId: "restaurant", text: "Kept" });
});
test("anonymized post comments retain thread identity", async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: { items: [{ id: "comment", post_id: "post", user_id: null, created_at: "posted", text: "Kept" }], total: 1 } });
  expect((await listSupabaseCommentsForPost("post")).items[0]).toMatchObject({ userId: "deleted_user", postId: "post", text: "Kept" });
});
