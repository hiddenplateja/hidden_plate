import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { recordSupabaseSession } from "@/services/supabaseSessionFence";
import { requestSupabaseRpc, requireSupabaseDataSession, rpcForSupabaseDataSession } from "@/services/supabaseDataRequest";
import { markSupabaseNotificationsRead, markAllSupabaseNotificationsRead, deleteSupabaseNotification, resolveSupabasePushNotification,
  listSupabaseNotifications, getSupabaseUnreadCount, registerSupabasePushToken, clearSupabasePushToken } from "@/services/supabaseNotifications";
import { bulkImportSupabaseRestaurants, deleteSupabaseRestaurant, listClaimedSupabaseRestaurants,
  adminCreateSupabaseRestaurant, updateSupabaseRestaurant, rebuildSupabaseRestaurantSearch } from "@/services/supabaseRestaurantAdmin";
import { supabaseCommand, supabaseQueuePage } from "@/services/supabaseAdminQueue";
import { getSupabaseAdminStats } from "@/services/supabaseAdmin";
import { setSupabaseUserBanned } from "@/services/supabaseUsers";
import { patchSupabaseAppControl } from "@/services/supabaseRemoteConfig";
import { processSupabaseMediaCleanup } from "@/services/supabaseStorage";
import * as Location from "expo-location";
import { createSupabasePost, deleteSupabasePost, listSupabasePostsByUser } from "@/services/supabasePosts";
import { createSupabaseReview, updateSupabaseReview, deleteSupabaseReview } from "@/services/supabaseReviews";
import { likeSupabaseReview, unlikeSupabasePost, addSupabaseReviewComment, addSupabasePostComment, deleteSupabaseComment,
  getSupabaseLikedReviewIds } from "@/services/supabaseSocial";
import { setSupabaseSaved, followSupabaseUser, setSupabaseBlocked, getSupabaseHiddenUserIds } from "@/services/supabaseRelationships";
import { createSupabaseCollection, updateSupabaseCollection, deleteSupabaseCollection, changeSupabaseCollectionMembership,
  getSupabaseCollectionWithRestaurants } from "@/services/supabaseCollections";
import { createSupabaseResponse, deleteSupabaseResponse } from "@/services/supabaseReviewResponses";
import { recordSupabaseRestaurantView } from "@/services/supabaseRestaurantViews";
import { createSupabaseRestaurant } from "@/services/supabaseRestaurants";
import { collectAllSupabaseMemberPages } from "@/services/supabasePagination";
import { hasSupabaseUserReported } from "@/services/supabaseReports";
import { getMySupabaseClaimForRestaurant } from "@/services/supabaseClaims";

jest.mock("@/services/supabase", () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn(), from: jest.fn() }, createIsolatedSupabaseAuthClient: jest.fn() }));
jest.mock("expo-location", () => ({ geocodeAsync: jest.fn() }));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "fixture" }));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@/services/supabaseStorage", () => ({ processSupabaseMediaCleanup: jest.fn() }));
const A = "fd000000-0000-4000-8000-000000000001", B = "fd000000-0000-4000-8000-000000000002";
const sessionA = { user: { id: A }, access_token: "fixture-token-a" };
const sessionB = { user: { id: B }, access_token: "fixture-token-b" };
let current: typeof sessionA | null;
const getUser = jest.fn(), execute = jest.fn(), executeRest = jest.fn(), rpc = jest.fn(), from = jest.fn();
const setSession = jest.fn(), signOut = jest.fn();
let headers: string[], filters: unknown[][];
const restaurant = { id: A, name: "Fixture", created_at: "fixture", updated_at: "fixture", slug: "fixture", parish: "kingston", address: "Road", latitude: 18, longitude: -77,
  cuisines: ["jamaican"], categories: [], image_paths: [], menu: [], average_rating: 4, review_count: 1, is_active: true, is_verified: true, is_featured: false };
const input = { name: "Fixture", address: "Road", parish: "kingston" as const, latitude: 18, longitude: -77, cuisines: ["Jamaican"], categories: [], imageIds: [] };
function transition(session: typeof sessionA | null) { current = session; recordSupabaseSession(session); }
beforeEach(() => {
  jest.resetAllMocks(); headers = []; filters = []; transition(null); transition(sessionA);
  (supabase.auth.getSession as jest.Mock).mockImplementation(async () => ({ data: { session: current }, error: null }));
  (supabase.rpc as jest.Mock).mockImplementation(() => { throw new Error("Shared credentials must not be used"); });
  (supabase.from as jest.Mock).mockImplementation(() => { throw new Error("Shared credentials must not be used"); });
  getUser.mockImplementation(async token => ({ data: { user: { id: token === sessionA.access_token ? A : B } }, error: null }));
  rpc.mockImplementation((...args) => ({ setHeader: (_name: string, token: string) => { headers.push(token); return execute(...args); } }));
  from.mockImplementation(table => {
    const query = { update: jest.fn(), delete: jest.fn(), select: jest.fn(), eq: jest.fn(), in: jest.fn(), single: jest.fn(), maybeSingle: jest.fn(), order: jest.fn(), limit: jest.fn(),
      setHeader: (_name: string, token: string) => { headers.push(token); return executeRest(table); } };
    query.update.mockReturnValue(query); query.delete.mockReturnValue(query); query.select.mockReturnValue(query);
    query.order.mockReturnValue(query); query.limit.mockReturnValue(query);
    query.in.mockReturnValue(query); query.single.mockReturnValue(query); query.maybeSingle.mockReturnValue(query);
    query.eq.mockImplementation((...args) => { filters.push(args); return query; });
    return query;
  });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser, setSession, signOut }, rpc, from });
  execute.mockImplementation(async name => ({ data: name === "is_admin" ? true : [restaurant], error: null }));
  executeRest.mockResolvedValue({ error: null });
  (processSupabaseMediaCleanup as jest.Mock).mockResolvedValue(undefined);
});

const reviewRow = { id: A, restaurant_id: B, user_id: A, rating: 4, image_paths: [], created_at: "fixture", updated_at: "fixture", comment: "Good" };
const postRow = { id: A, user_id: A, text: "Fixture", image_paths: [], created_at: "fixture" };
const collectionRow = { id: B, owner_id: A, title: "Fixture", restaurant_ids: [], is_public: false, created_at: "fixture", updated_at: "fixture" };
const mutationCases = [
  { label: "create post", run: () => createSupabasePost({ text: "Fixture" }), rpc: "create_community_post", data: [postRow] },
  { label: "delete post", run: () => deleteSupabasePost(B), rpc: "delete_community_content", data: null },
  { label: "create review", run: () => createSupabaseReview({ restaurantId: B, rating: 4 }), rpc: "write_review", data: [reviewRow] },
  { label: "edit review", run: () => updateSupabaseReview(A, { comment: "Updated" }), rpc: "write_review", data: [reviewRow] },
  { label: "like review", run: () => likeSupabaseReview(B), rpc: "set_community_like", data: null },
  { label: "unlike post", run: () => unlikeSupabasePost(B), rpc: "set_community_like", data: null },
  { label: "review comment", run: () => addSupabaseReviewComment({ reviewId: B, restaurantId: B, text: "Nice" }), rpc: "write_community_comment", data: { id: A, review_id: B, restaurant_id: B, user_id: A, text: "Nice" } },
  { label: "post comment", run: () => addSupabasePostComment({ postId: B, text: "Nice" }), rpc: "write_community_comment", data: { id: A, post_id: B, user_id: A, text: "Nice" } },
  { label: "delete comment", run: () => deleteSupabaseComment(B), rpc: "delete_community_content", data: null },
  { label: "save", run: () => setSupabaseSaved(B, "visited", true), rpc: "set_member_saved", data: B },
  { label: "follow", run: () => followSupabaseUser(B), rpc: "set_member_follow", data: B },
  { label: "block", run: () => setSupabaseBlocked(B, true), rpc: "set_member_block", data: B },
  { label: "create collection", run: () => createSupabaseCollection({ title: "Fixture" }), rpc: "write_member_collection", data: collectionRow },
  { label: "edit collection", run: () => updateSupabaseCollection(B, { title: "Updated" }), rpc: "write_member_collection", data: collectionRow },
  { label: "delete collection", run: () => deleteSupabaseCollection(B), rpc: "delete_member_collection", data: B },
  { label: "collection membership", run: () => changeSupabaseCollectionMembership(B, A, true), rpc: "change_collection_membership", data: collectionRow },
  { label: "owner reply", run: () => createSupabaseResponse({ reviewId: B, restaurantId: B, text: "Thanks" }), rpc: "write_owner_response", data: { id: A, author_id: A, review_id: B, restaurant_id: B, text: "Thanks" } },
  { label: "delete reply", run: () => deleteSupabaseResponse(B), rpc: "delete_owner_response", data: null },
  { label: "restaurant submission", run: () => createSupabaseRestaurant(input), rpc: "submit_restaurant", data: [restaurant] },
];
test.each(mutationCases)("$label uses the original verified token", async ({ run, rpc: name, data }) => {
  execute.mockResolvedValueOnce({ data, error: null });
  await run();
  expect(execute.mock.calls[0][0]).toBe(name);
  expect(headers).toEqual(["Bearer fixture-token-a"]);
  expect(setSession).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
});
test.each(mutationCases)("$label cannot start after a switch during identity proof", async ({ run }) => {
  getUser.mockImplementationOnce(async () => { transition(sessionB); return { data: { user: { id: A } } }; });
  await expect(run()).rejects.toThrow("session changed");
  expect(execute).not.toHaveBeenCalled();
});
test.each(mutationCases)("$label discards late success without retrying as another account", async ({ run, data }) => {
  execute.mockImplementationOnce(async () => { transition(sessionB); return { data, error: null }; });
  await expect(run()).rejects.toThrow("session changed");
  expect(execute).toHaveBeenCalledTimes(1); expect(headers).toEqual(["Bearer fixture-token-a"]);
});
test("review deletion uses fixed credentials and lets database owner/admin policy decide permission", async () => {
  executeRest.mockResolvedValueOnce({ data: [{ id: A }], error: null });
  await deleteSupabaseReview(A);
  expect(filters).toEqual([["id", A]]); expect(headers).toEqual(["Bearer fixture-token-a"]);
  executeRest.mockResolvedValueOnce({ data: [], error: null });
  await expect(deleteSupabaseReview(B)).rejects.toThrow("permission denied");
});
test("a switch during review deletion discards success and never retries the delete", async () => {
  executeRest.mockImplementationOnce(async () => { transition(sessionB); return { data: [{ id: A }] }; });
  await expect(deleteSupabaseReview(A)).rejects.toThrow("session changed");
  expect(executeRest).toHaveBeenCalledTimes(1);
});
test("view analytics stays non-blocking without adopting a replacement account", async () => {
  getUser.mockImplementationOnce(async () => { transition(sessionB); return { data: { user: { id: A } } }; });
  await expect(recordSupabaseRestaurantView(B)).resolves.toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
});
test("full member lists keep one proof/token through more than 2,000 records", async () => {
  const rows = Array.from({ length: 2001 }, (_, n) => ({ id: `fa000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}` }));
  execute.mockImplementation(async (_name, args) => {
    const start = args.after_id ? rows.findIndex(row => row.id === args.after_id) + 1 : 0;
    return { data: { items: rows.slice(start, start + args.page_size + 1), total: rows.length } };
  });
  expect(await collectAllSupabaseMemberPages("member_hidden_user_page", {})).toEqual(rows);
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(9); expect(headers.every(value => value === "Bearer fixture-token-a")).toBe(true);
});
test("a switch between member-list pages prevents any second request", async () => {
  execute.mockImplementationOnce(async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: sessionA } })
      .mockImplementationOnce(async () => { transition(sessionB); return { data: { session: sessionB } }; });
    return { data: { items: Array.from({ length: 251 }, (_, n) => ({ id: `fa000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}` })), total: 251 } };
  });
  await expect(getSupabaseHiddenUserIds()).rejects.toThrow(/changed/);
  expect(execute).toHaveBeenCalledTimes(1);
});
test("partial liked-ID batches are discarded after an account switch", async () => {
  const ids = Array.from({ length: 101 }, (_, n) => `fa000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
  executeRest.mockResolvedValueOnce({ data: [{ review_id: ids[0] }] }).mockImplementationOnce(async () => {
    transition(sessionB); return { data: [{ review_id: ids[100] }] };
  });
  expect(await getSupabaseLikedReviewIds(ids)).toEqual(new Set());
  expect(headers).toEqual(["Bearer fixture-token-a", "Bearer fixture-token-a"]);
});
test("member-only feeds use a pinned token and discard switched-account pages", async () => {
  execute.mockImplementationOnce(async () => { transition(sessionB); return { data: { items: [postRow], total: 1 } }; });
  await expect(listSupabasePostsByUser(A)).rejects.toThrow("session changed");
});
test("private collection hydration cannot return to a different account", async () => {
  executeRest.mockResolvedValueOnce({ data: { ...collectionRow, restaurant_ids: [A] } });
  (supabase.from as jest.Mock).mockImplementationOnce(() => {
    transition(sessionB);
    return { select: () => ({ in: async () => ({ data: [restaurant] }) }) };
  });
  await expect(getSupabaseCollectionWithRestaurants(B)).rejects.toThrow("session changed");
});
test("report/claim lookups keep owner filters and discard late private replies", async () => {
  executeRest.mockImplementationOnce(async () => { transition(sessionB); return { data: [{ id: A }] }; });
  expect(await hasSupabaseUserReported(B)).toBe(false);
  expect(filters).toContainEqual(["reported_by_user_id", A]);
  transition(sessionA);
  executeRest.mockImplementationOnce(async () => { transition(sessionB); return { data: [{ id: A, user_id: A }] }; });
  await expect(getMySupabaseClaimForRestaurant(B)).rejects.toThrow("session changed");
  expect(filters).toContainEqual(["user_id", A]);
  expect(headers).toEqual(["Bearer fixture-token-a", "Bearer fixture-token-a"]);
});
test("claim status errors fail closed instead of masquerading as no pending claim", async () => {
  executeRest.mockResolvedValueOnce({ data: null, error: { message: "Offline" } });
  await expect(getMySupabaseClaimForRestaurant(B)).rejects.toThrow("Couldn't check your claim status");
  executeRest.mockResolvedValueOnce({ data: [], error: null });
  expect(await getMySupabaseClaimForRestaurant(B)).toBeNull();
});
test("push resolution uses owner-filtered RLS reads and fixed credentials", async () => {
  executeRest.mockResolvedValueOnce({ data: { id: B, user_id: A, actor_id: null, type: "comment", title: "Fixture", body: "Fixture", data: {}, is_read: false } });
  expect(await resolveSupabasePushNotification(B, A)).toMatchObject({ id: B, userId: A });
  expect(filters).toEqual([["id", B], ["user_id", A]]); expect(headers).toEqual(["Bearer fixture-token-a"]);
});
test("push resolution cannot use a supplied owner to read another account", async () => {
  expect(await resolveSupabasePushNotification(B, B)).toBeNull(); expect(executeRest).not.toHaveBeenCalled();
});
test("missing/foreign inbox rows and switches during push reads are ignored", async () => {
  executeRest.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { id: B, user_id: B } });
  expect(await resolveSupabasePushNotification(B, A)).toBeNull(); expect(await resolveSupabasePushNotification(B, A)).toBeNull();
  executeRest.mockImplementationOnce(async () => { transition(sessionB); return { data: { id: B, user_id: A } }; });
  expect(await resolveSupabasePushNotification(B, A)).toBeNull();
});

test("RPCs verify exact credentials without installing, refreshing or signing out a session", async () => {
  await requestSupabaseRpc("admin_write_restaurant", { payload: {} });
  expect(getUser).toHaveBeenCalledWith("fixture-token-a");
  expect(headers).toEqual(["Bearer fixture-token-a"]);
  expect(setSession).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
});
test("a switch during network identity proof prevents the RPC from starting", async () => {
  getUser.mockImplementationOnce(async () => { transition(sessionB); return { data: { user: { id: A } } }; });
  await expect(requestSupabaseRpc("admin_write_restaurant")).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
test("an earlier pinned session cannot be reused by the next account", async () => {
  const pinned = await requireSupabaseDataSession(); transition(sessionB);
  await expect(rpcForSupabaseDataSession(pinned, "admin_write_restaurant")).rejects.toThrow("session changed");
  expect(execute).not.toHaveBeenCalled();
});
test("a late response is discarded even after returning to the same original account/token", async () => {
  execute.mockImplementationOnce(async () => { transition(sessionB); transition(sessionA); return { data: "stale" }; });
  await expect(requestSupabaseRpc("admin_dashboard_stats")).rejects.toThrow("session changed");
  expect(headers).toEqual(["Bearer fixture-token-a"]);
});
test("inbox mark/read-all/delete retain recipient filters and a fixed token", async () => {
  await markSupabaseNotificationsRead(A); await markAllSupabaseNotificationsRead(); await deleteSupabaseNotification(A);
  expect(filters.filter(([key]) => key === "user_id")).toEqual([["user_id", A], ["user_id", A], ["user_id", A]]);
  expect(headers).toEqual(Array(3).fill("Bearer fixture-token-a"));
  expect(from.mock.results[0].value.update).toHaveBeenCalledWith({ is_read: true });
});
test("late inbox write completion does not publish success for the replacement account", async () => {
  executeRest.mockImplementationOnce(async () => { transition(sessionB); return { error: null }; });
  await expect(deleteSupabaseNotification(A)).rejects.toThrow("session changed");
  expect(filters).toContainEqual(["user_id", A]); expect(headers).toEqual(["Bearer fixture-token-a"]);
});
test("signed-out mark-all/read count/list make no data request", async () => {
  transition(null); await markAllSupabaseNotificationsRead();
  expect(await getSupabaseUnreadCount()).toBe(0);
  expect((await listSupabaseNotifications()).items).toEqual([]);
  expect(execute).not.toHaveBeenCalled(); expect(executeRest).not.toHaveBeenCalled();
});
test("inbox paging rejects switched identity and wrongly addressed rows", async () => {
  execute.mockImplementationOnce(async () => { transition(sessionB); return { data: { items: [], total: 0 } }; });
  await expect(listSupabaseNotifications()).rejects.toThrow("session changed");
  transition(sessionA); execute.mockResolvedValueOnce({ data: { items: [{ id: A, user_id: B }], total: 1 } });
  await expect(listSupabaseNotifications()).rejects.toThrow("your inbox");
});
test("unread counts discard old-account replies and malformed negative/fractional counts", async () => {
  execute.mockImplementationOnce(async () => { transition(sessionB); return { data: 19 }; });
  expect(await getSupabaseUnreadCount()).toBe(0);
  transition(sessionA); execute.mockResolvedValueOnce({ data: -1 }).mockResolvedValueOnce({ data: 2.5 });
  expect(await getSupabaseUnreadCount()).toBe(0); expect(await getSupabaseUnreadCount()).toBe(0);
});
test("push compatibility writes pin identity and scope deletion to its exact token", async () => {
  await registerSupabasePushToken("fixture-push", "android"); await clearSupabasePushToken("fixture-push");
  expect(execute).toHaveBeenCalledWith("register_push_token", { push_token: "fixture-push", device_platform: "android" });
  expect(filters).toEqual([["user_id", A], ["token", "fixture-push"]]);
  expect(headers).toEqual(["Bearer fixture-token-a", "Bearer fixture-token-a"]);
});
test("moderation/owner menu/report commands and private admin queues use request-local tokens", async () => {
  await supabaseCommand("admin_moderate_content", { target_id: A });
  execute.mockResolvedValueOnce({ data: [] });
  expect((await supabaseQueuePage("claim", row => row)).items).toEqual([]);
  expect(headers).toEqual(["Bearer fixture-token-a", "Bearer fixture-token-a"]);
});
test("admin profile ban, config and restaurant mutations all route through pinned RPCs", async () => {
  await setSupabaseUserBanned(B, true);
  execute.mockResolvedValueOnce({ data: { maintenance: false } }); await patchSupabaseAppControl({ maintenance: false });
  await adminCreateSupabaseRestaurant(input); await updateSupabaseRestaurant(A, { name: "Updated" });
  execute.mockResolvedValueOnce({ data: { scanned: 2, updated: 1 } }); await rebuildSupabaseRestaurantSearch();
  expect(headers).toEqual(Array(5).fill("Bearer fixture-token-a"));
});
test("admin dashboard replies cannot cross account transitions", async () => {
  execute.mockImplementationOnce(async () => { transition(sessionB); return { data: { users: 123 } }; });
  await expect(getSupabaseAdminStats()).rejects.toThrow("session changed");
});
test("a switch during geocoding stops bulk imports before any row writes", async () => {
  (Location.geocodeAsync as jest.Mock).mockImplementationOnce(async () => { transition(sessionB); return [{ latitude: 18, longitude: -77 }]; });
  await expect(bulkImportSupabaseRestaurants([{ ...input, latitude: undefined, longitude: undefined }, input])).rejects.toThrow("session changed");
  expect(execute.mock.calls.map(([name]) => name)).toEqual(["is_admin"]);
  expect(Location.geocodeAsync).toHaveBeenCalledTimes(1);
});
test("bulk import preserves one original admin across its role check and all rows", async () => {
  expect(await bulkImportSupabaseRestaurants([input, { ...input, name: "Second" }])).toEqual({ created: 2, failed: 0, errors: [] });
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(headers).toEqual(Array(3).fill("Bearer fixture-token-a"));
});
test("claimed listing pages cannot mix two admin accounts", async () => {
  execute.mockImplementationOnce(async () => {
    transition(sessionB);
    return { data: { items: Array.from({ length: 101 }, () => restaurant), total: 101 } };
  });
  await expect(listClaimedSupabaseRestaurants()).rejects.toThrow("session changed");
  expect(execute).toHaveBeenCalledTimes(1);
});
test("deletion passes its original identity to optional cleanup instead of adopting the next session", async () => {
  await deleteSupabaseRestaurant(A);
  expect(processSupabaseMediaCleanup).toHaveBeenCalledWith(expect.objectContaining({ userId: A, accessToken: "fixture-token-a" }));
  expect(headers).toEqual(["Bearer fixture-token-a"]);
});
test("server authorization errors remain visible and never fall back to shared credentials", async () => {
  execute.mockResolvedValueOnce({ error: { message: "Admin access required." } });
  await expect(supabaseCommand("admin_moderate_content", {})).rejects.toThrow("Admin access required.");
  expect(supabase.rpc).not.toHaveBeenCalled(); expect(supabase.from).not.toHaveBeenCalled();
});
