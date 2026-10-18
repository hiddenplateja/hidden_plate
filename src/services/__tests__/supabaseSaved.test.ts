import { getSupabaseScreenSavedStatus, toggleSupabaseScreenSaved, listSupabaseScreenSavedByUser, listSupabaseScreenSavedRestaurants } from "@/services/supabaseSaved";
import { pinSupabaseSession, currentSupabaseSessionIdentity } from "@/services/supabasePinnedSession";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("@/services/supabasePinnedSession", () => ({ pinSupabaseSession: jest.fn(), currentSupabaseSessionIdentity: jest.fn() }));
jest.mock("@/services/supabaseRestaurants", () => ({ getSupabaseRestaurantsByIds: jest.fn() }));

const id = (n: number) => `fe130000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), accessToken: "test-account-a-token" };
const pin = pinSupabaseSession as jest.Mock, current = currentSupabaseSessionIdentity as jest.Mock;
const hydrate = getSupabaseRestaurantsByIds as jest.Mock;
let rpc: jest.Mock, from: jest.Mock, setHeader: jest.Mock, tableQuery: Record<string, jest.Mock>;
let selectResult: { data: { list_type: string }[] | null; error?: { message: string } };
function response(value: unknown) {
  return { setHeader: (name: string, header: string) => { setHeader(name, header); return { abortSignal: async () => value }; } };
}
beforeEach(() => {
  jest.resetAllMocks(); setHeader = jest.fn(); selectResult = { data: [] };
  rpc = jest.fn(() => response({ data: { items: [], total: 0 }, error: null }));
  tableQuery = { select: jest.fn(), eq: jest.fn(), setHeader: jest.fn(), abortSignal: jest.fn(async () => selectResult) };
  tableQuery.select.mockReturnValue(tableQuery); tableQuery.eq.mockReturnValue(tableQuery);
  tableQuery.setHeader.mockImplementation((...args) => { setHeader(...args); return tableQuery; });
  from = jest.fn(() => tableQuery);
  pin.mockResolvedValue({ ...identity, client: { rpc, from } }); current.mockResolvedValue(identity);
  hydrate.mockResolvedValue(new Map());
});

test("saved status keeps original string-or-null contract using opaque composite IDs", async () => {
  selectResult.data = [{ list_type: "favorite" }, { list_type: "visited" }];
  expect(await getSupabaseScreenSavedStatus(id(2))).toEqual({ favorite: `${id(1)}:${id(2)}:favorite`, want_to_go: null, visited: `${id(1)}:${id(2)}:visited` });
  expect(tableQuery.eq.mock.calls).toEqual([["user_id", id(1)], ["restaurant_id", id(2)]]);
  expect(setHeader).toHaveBeenCalledWith("Authorization", `Bearer ${identity.accessToken}`);
});
test("status remains tolerant for signed-out, invalid or failed reads", async () => {
  selectResult.error = { message: "offline" };
  expect(await getSupabaseScreenSavedStatus(id(2))).toEqual({ favorite: null, want_to_go: null, visited: null });
  pin.mockResolvedValue(null);
  expect(await getSupabaseScreenSavedStatus(id(2))).toEqual({ favorite: null, want_to_go: null, visited: null });
  expect(await getSupabaseScreenSavedStatus("invalid")).toEqual({ favorite: null, want_to_go: null, visited: null });
});
test("toggle uses one pinned atomic write and returns server-reconciled exclusivity", async () => {
  rpc.mockReturnValue(response({ data: id(2), error: null })); selectResult.data = [{ list_type: "visited" }, { list_type: "favorite" }];
  const result = await toggleSupabaseScreenSaved(id(2), "visited", { favorite: "old-fav", want_to_go: "old-want", visited: null });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("set_member_saved", { target_restaurant: id(2), saved_list: "visited", should_save: true });
  expect(result.want_to_go).toBeNull(); expect(result.visited).toBeTruthy(); expect(result.favorite).toBeTruthy();
});
test("toggle removal does not treat opaque IDs as database row IDs", async () => {
  rpc.mockReturnValue(response({ data: id(2), error: null }));
  await toggleSupabaseScreenSaved(id(2), "favorite", { favorite: "opaque-doc-id", want_to_go: null, visited: null });
  expect(rpc.mock.calls[0][1].should_save).toBe(false);
  expect(from).toHaveBeenCalledWith("saved_restaurants");
});
test("toggle errors are surfaced without silently reporting success", async () => {
  rpc.mockReturnValue(response({ data: null, error: { message: "denied" } }));
  await expect(toggleSupabaseScreenSaved(id(2), "favorite", { favorite: null, want_to_go: null, visited: null })).rejects.toThrow("denied");
  rpc.mockReturnValue(response({ data: id(3), error: null }));
  await expect(toggleSupabaseScreenSaved(id(2), "favorite", { favorite: null, want_to_go: null, visited: null })).rejects.toThrow("Couldn't update");
  pin.mockResolvedValue(null);
  await expect(toggleSupabaseScreenSaved(id(2), "favorite", { favorite: null, want_to_go: null, visited: null })).rejects.toThrow("signed in");
});
test("account/token replacement discards saved state and mutation results", async () => {
  current.mockResolvedValue({ ...identity, accessToken: "replacement-token" });
  selectResult.data = [{ list_type: "favorite" }];
  expect((await getSupabaseScreenSavedStatus(id(2))).favorite).toBeNull();
  rpc.mockReturnValue(response({ data: id(2), error: null }));
  await expect(toggleSupabaseScreenSaved(id(2), "favorite", { favorite: null, want_to_go: null, visited: null })).rejects.toThrow("account changed");
});
test("all-list preview merges save times across buckets and applies the final limit", async () => {
  rpc.mockImplementation((_name, args) => response({ data: { items: [{ id: id(args.saved_list === "favorite" ? 2 : args.saved_list === "visited" ? 3 : 4),
    list_type: args.saved_list, created_at: args.saved_list === "favorite" ? "2026-10-10" : args.saved_list === "visited" ? "2026-10-13" : "2026-10-12" }], total: 1 }, error: null }));
  const rows = await listSupabaseScreenSavedByUser(undefined, 2);
  expect(rows.map(row => row.listType)).toEqual(["visited", "want_to_go"]);
  expect(rows.every(row => row.userId === id(1))).toBe(true);
  expect(rpc).toHaveBeenCalledTimes(3);
  expect(setHeader.mock.calls.every(args => args[1] === `Bearer ${identity.accessToken}`)).toBe(true);
});
test("large saved list continues beyond API row cap with pinned credentials", async () => {
  const rows = Array.from({ length: 301 }, (_, n) => ({ id: id(n + 2), list_type: "favorite", created_at: "2026-10-13" }));
  rpc.mockImplementation((_name, args) => {
    const offset = args.after_id ? rows.findIndex(row => row.id === args.after_id) + 1 : 0;
    return response({ data: { items: rows.slice(offset, offset + args.page_size + 1), total: rows.length }, error: null });
  });
  expect(await listSupabaseScreenSavedByUser("favorite", 300)).toHaveLength(300);
  expect(rpc.mock.calls[1][1]).toMatchObject({ after_id: id(251), page_size: 50 });
});
test("hydrated saves preserve unavailable listings and preview limit", async () => {
  rpc.mockReturnValue(response({ data: { items: [{ id: id(2), created_at: "2026-10-13", list_type: "favorite" }], total: 1 }, error: null }));
  const rows = await listSupabaseScreenSavedRestaurants("favorite", 6);
  expect(rows[0]).toMatchObject({ saved: { restaurantId: id(2), userId: id(1) }, restaurant: null });
  expect(rpc.mock.calls[0][1].page_size).toBe(6);
  hydrate.mockRejectedValue(new Error("temporarily missing"));
  expect((await listSupabaseScreenSavedRestaurants("favorite", 6))[0].restaurant).toBeNull();
});
test("signed-out saved readers return empty arrays and invalid/broken lists fail", async () => {
  pin.mockResolvedValue(null);
  expect(await listSupabaseScreenSavedByUser()).toEqual([]); expect(await listSupabaseScreenSavedRestaurants("favorite")).toEqual([]);
  pin.mockResolvedValue({ ...identity, client: { rpc, from } });
  await expect(listSupabaseScreenSavedByUser("bad" as "favorite")).rejects.toThrow("Invalid saved list");
  rpc.mockReturnValue(response({ error: { message: "offline" }, data: null }));
  await expect(listSupabaseScreenSavedByUser("favorite")).rejects.toThrow("offline");
});
