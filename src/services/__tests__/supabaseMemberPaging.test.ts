import { supabase } from "@/services/supabase";
import { getSupabaseHiddenUserIds, listSupabaseBlockedProfiles, listSupabaseBlockedProfilePage,
  listSupabaseSavedRestaurants, listSupabaseSavedRestaurantPage, getMySupabaseSavedCount } from "@/services/supabaseRelationships";
import { listSupabaseCollections, listSupabaseCollectionPage } from "@/services/supabaseCollections";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import { createSupabaseReview, updateSupabaseReview } from "@/services/supabaseReviews";
import { registerSupabasePushToken } from "@/services/supabaseNotifications";
jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase));
jest.mock("@/services/supabaseRestaurants", () => ({ getSupabaseRestaurantsByIds: jest.fn() }));
const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const auth = supabase.auth.getUser as jest.Mock;
const hydrate = getSupabaseRestaurantsByIds as jest.Mock;
const id = (n: number) => `fc230000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profile = { id: id(2), username: "person", display_name: "Person", avatar_path: null, bio: "Bio", is_banned: false, created_at: "joined" };
const collection = { id: id(1), owner_id: id(2), title: "Dinner", description: null, is_public: true, restaurant_ids: [],
  cover_restaurant_id: null, created_at: "created", updated_at: "updated" };
function mockPages<Row extends { id: string }>(rows: Row[]) {
  rpc.mockImplementation(async (_, args) => {
    const start = args.after_id ? rows.findIndex(row => row.id === args.after_id) + 1 : 0;
    return { data: { items: rows.slice(start, start + args.page_size + 1), total: rows.length } };
  });
}
beforeEach(() => { jest.resetAllMocks(); rpc.mockResolvedValue({ data: { items: [], total: 0 } });
  hydrate.mockImplementation(async (ids: string[]) => new Map(ids.map(value => [value, { id: value, name: value }]))); });

test("hidden union collects beyond 2,000 without a direct/table-capped query", async () => {
  const rows = Array.from({ length: 2101 }, (_, n) => ({ id: id(n + 1) })); mockPages(rows);
  const hidden = await getSupabaseHiddenUserIds(); expect(hidden.size).toBe(2101); expect(hidden.has(id(2101))).toBe(true);
  expect(rpc).toHaveBeenCalledTimes(9); expect(rpc.mock.calls[8]).toEqual(["member_hidden_user_page", { after_id: id(2000), page_size: 250 }]);
  expect(from).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled();
});
test("hidden union fails rather than returning a partial privacy filter", async () => {
  const rows = Array.from({ length: 251 }, (_, n) => ({ id: id(n + 1) }));
  rpc.mockResolvedValueOnce({ data: { items: rows, total: 251 } }).mockResolvedValueOnce({ error: { message: "Offline" } });
  await expect(getSupabaseHiddenUserIds()).rejects.toThrow("Offline");
});
test("repeated rows/cursor are rejected in full-list readers", async () => {
  const rows = Array.from({ length: 251 }, (_, n) => ({ id: id(n + 1) }));
  rpc.mockResolvedValue({ data: { items: rows, total: 251 } });
  await expect(getSupabaseHiddenUserIds()).rejects.toThrow("continue"); expect(rpc).toHaveBeenCalledTimes(2);
});
test("blocked management keeps relationship order and public raw-profile contract", async () => {
  mockPages([{ id: id(2), created_at: "blocked", profile }, { id: id(3), created_at: "older", profile: { ...profile, id: id(3) } }]);
  expect(await listSupabaseBlockedProfiles()).toEqual([profile, { ...profile, id: id(3) }]);
  expect(rpc.mock.calls[0][0]).toBe("member_blocked_profile_page"); expect(from).not.toHaveBeenCalled();
});
test("blocked profile pages return continuation and full count", async () => {
  rpc.mockResolvedValue({ data: { items: [{ id: id(2), created_at: "blocked", profile }, { id: id(3), profile }], total: 1101 } });
  expect(await listSupabaseBlockedProfilePage({ pageSize: 1, cursor: id(7) })).toMatchObject({ items: [profile], total: 1101, hasMore: true, nextCursor: id(2) });
  expect(rpc).toHaveBeenCalledWith("member_blocked_profile_page", { page_size: 1, after_id: id(7) });
});
test("saved arrays read all rows above API cap and hydrate in save order", async () => {
  mockPages(Array.from({ length: 1101 }, (_, n) => ({ id: id(n + 1), created_at: "saved", list_type: "visited" })));
  const rows = await listSupabaseSavedRestaurants("visited"); expect(rows).toHaveLength(1101); expect(rows.at(-1)?.id).toBe(id(1101));
  expect(rpc.mock.calls[0]).toEqual(["member_saved_page", { saved_list: "visited", after_id: null, page_size: 250 }]);
});
test("saved cursor stays on save rows when an inactive restaurant cannot hydrate", async () => {
  rpc.mockResolvedValue({ data: { items: [{ id: id(2) }, { id: id(3) }, { id: id(4) }], total: 3 } });
  hydrate.mockResolvedValue(new Map([[id(3), { id: id(3), name: "Visible" }]]));
  expect(await listSupabaseSavedRestaurantPage("favorite", { pageSize: 2 })).toMatchObject({ items: [{ id: id(3) }], nextCursor: id(3), total: 3, hasMore: true });
});
test("saved count uses full database aggregate and tolerates secondary failure", async () => {
  rpc.mockResolvedValueOnce({ data: 1101 }).mockResolvedValueOnce({ error: { message: "Offline" } }).mockResolvedValueOnce({ data: -1 });
  expect(await getMySupabaseSavedCount()).toBe(1101); expect(rpc).toHaveBeenCalledWith("member_saved_count");
  expect(await getMySupabaseSavedCount()).toBe(0); expect(await getMySupabaseSavedCount()).toBe(0);
});
test("collection arrays collect all pages, retaining update-order fields", async () => {
  mockPages(Array.from({ length: 1101 }, (_, n) => ({ ...collection, id: id(n + 1) })));
  const rows = await listSupabaseCollections(); expect(rows).toHaveLength(1101);
  expect(rows[0]).toMatchObject({ title: "Dinner", ownerId: id(2), updatedAt: "updated" });
  expect(rpc.mock.calls[0]).toEqual(["member_collection_page", { target_user: null, public_only: false, after_id: null, page_size: 250 }]);
  expect(from).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled();
});
test("public-owner collection page uses visible count and cursor", async () => {
  rpc.mockResolvedValue({ data: { items: [collection, { ...collection, id: id(3) }], total: 20 } });
  expect(await listSupabaseCollectionPage(id(2), true, { pageSize: 1, cursor: id(7) })).toMatchObject({ total: 20, hasMore: true, nextCursor: id(1), items: [{ isPublic: true }] });
  expect(rpc.mock.calls[0][1]).toEqual({ target_user: id(2), public_only: true, after_id: id(7), page_size: 1 });
});
test("paging rejects invalid owners, buckets, visibility and cursors locally", async () => {
  await expect(listSupabaseCollections("bad")).rejects.toThrow("Invalid user");
  await expect(listSupabaseCollections(undefined, null as never)).rejects.toThrow("Invalid collection");
  await expect(listSupabaseSavedRestaurants("saved" as never)).rejects.toThrow("Invalid saved");
  await expect(listSupabaseBlockedProfilePage({ cursor: "bad" })).rejects.toThrow("Invalid cursor");
  expect(rpc).not.toHaveBeenCalled();
});
test("private paging failures surface instead of becoming empty successful lists", async () => {
  rpc.mockResolvedValue({ error: { message: "Finish signup" } });
  await expect(listSupabaseCollections()).rejects.toThrow("Finish signup");
  await expect(listSupabaseBlockedProfiles()).rejects.toThrow("Finish signup");
  await expect(listSupabaseSavedRestaurants("favorite")).rejects.toThrow("Finish signup");
});
test("review write/notification adapters surface the new active-account guard", async () => {
  rpc.mockResolvedValue({ error: { message: "You must be signed in to an active account." } });
  await expect(createSupabaseReview({ restaurantId: id(1), rating: 5, comment: "Nice" })).rejects.toThrow("active account");
  await expect(updateSupabaseReview(id(1), { rating: 4 })).rejects.toThrow("active account");
  await expect(registerSupabasePushToken("ExpoPushToken[fixture]", "android")).rejects.toThrow("active account");
});
