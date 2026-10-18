import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { getSupabaseSuggestedUsers, getSupabaseUserById, getSupabaseUsersByIds, listSupabaseUsers,
  searchSupabaseUsers, setSupabaseUserBanned, updateMySupabaseProfile } from "@/services/supabaseUsers";

jest.mock("@/services/supabase", () => ({ supabase: {
  from: jest.fn(), rpc: jest.fn(), auth: { getUser: jest.fn(), getSession: jest.fn() },
}, createIsolatedSupabaseAuthClient: jest.fn() }));
// Admin payload contracts; real request pinning is exercised in the race suite.
jest.mock("@/services/supabaseDataRequest", () => ({ requestSupabaseRpc: (...args: unknown[]) => (supabase.rpc as jest.Mock)(...args) }));
const A = "f7000000-0000-4000-8000-000000000001";
const B = "f7000000-0000-4000-8000-000000000002";
const row = { id: A, username: "foodie", display_name: "Foodie", avatar_path: null,
  bio: null, created_at: "2026-10-07", is_banned: false, email: "must-not-expose@example.test", preferences: { secret: true }, role: "admin" };
const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const auth = supabase.auth as unknown as Record<string, jest.Mock>;
let select: jest.Mock, batch: jest.Mock, maybeSingle: jest.Mock, pinnedRpc: jest.Mock, header: jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  batch = jest.fn().mockResolvedValue({ data: [row], error: null });
  maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
  select = jest.fn().mockReturnValue({ in: batch, eq: jest.fn().mockReturnValue({ maybeSingle }) });
  from.mockReturnValue({ select });
  rpc.mockResolvedValue({ data: [row], error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: A } }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: A }, access_token: "test-access", refresh_token: "test-refresh" } }, error: null });
  header = jest.fn().mockResolvedValue({ data: [row], error: null });
  pinnedRpc = jest.fn().mockReturnValue({ setHeader: header });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ rpc: pinnedRpc,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: A } }, error: null }) } });
});
test("public mapping never exposes auth email, preferences or role", async () => {
  const user = await getSupabaseUserById(A);
  expect(user).toMatchObject({ email: "", id: A, displayName: "Foodie" });
  expect(user).not.toHaveProperty("role"); expect(user).not.toHaveProperty("preferences");
  expect(from).toHaveBeenCalledWith("public_profiles");
  expect(select.mock.calls[0][0]).not.toMatch(/email|role|preferences/);
});

test("public avatars resolve keys and retain external provider URLs", async () => {
  const previous=process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL="https://media.example.test";
  try {
    maybeSingle.mockResolvedValueOnce({data:{...row,avatar_path:`usr/${A}/avatar.jpg`}})
      .mockResolvedValueOnce({data:{...row,avatar_path:"https://google.example.test/photo"}});
    expect((await getSupabaseUserById(A))?.avatarUrl).toBe(`https://media.example.test/media/usr/${A}/avatar.jpg`);
    expect((await getSupabaseUserById(A))?.avatarUrl).toBe("https://google.example.test/photo");
  } finally {
    if (previous===undefined) delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL; else process.env.EXPO_PUBLIC_MEDIA_WORKER_URL=previous;
  }
});
test("empty/invalid IDs do not call the database", async () => {
  expect(await getSupabaseUsersByIds(["invalid"])).toEqual(new Map());
  expect(await getSupabaseUserById("invalid")).toBeNull(); expect(from).not.toHaveBeenCalled();
});
test("batch reads dedupe and chunk more than 100 IDs", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `f7000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
  await getSupabaseUsersByIds([...ids, ids[0]]);
  expect(batch.mock.calls.map((args) => args[1].length)).toEqual([100,100,5]);
});
test("public read errors preserve tolerant missing-user behavior", async () => {
  batch.mockResolvedValue({ error: { message: "Offline" } });
  maybeSingle.mockRejectedValue(new Error("Offline"));
  expect(await getSupabaseUsersByIds([A])).toEqual(new Map());
  expect(await getSupabaseUserById(A)).toBeNull();
});
test("admin pagination uses a server keyset cursor and an extra row for hasMore", async () => {
  rpc.mockResolvedValue({ data: [row, { ...row, id: B }], error: null });
  const page = await listSupabaseUsers({ cursor: B, pageSize: 1 });
  expect(rpc).toHaveBeenCalledWith("admin_list_profiles", { after_id: B, page_size: 1 });
  expect(page).toMatchObject({ nextCursor: A, hasMore: true }); expect(page.items).toHaveLength(1);
});
test("an exact full final page has no fake next page", async () => {
  const page = await listSupabaseUsers({ pageSize: 1 });
  expect(page.hasMore).toBe(false);
  rpc.mockResolvedValue({ data: [], error: null });
  expect(await listSupabaseUsers()).toEqual({ items: [], nextCursor: null, hasMore: false });
});
test("admin errors are not disguised as an empty list", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "Admin access required." } });
  await expect(listSupabaseUsers()).rejects.toThrow("Admin access required.");
  await expect(setSupabaseUserBanned(B, true)).rejects.toThrow("Admin access required.");
});
test("ban/unban never updates profile fields directly", async () => {
  await setSupabaseUserBanned(B, true); await setSupabaseUserBanned(B, false);
  expect(rpc.mock.calls).toEqual([["admin_set_user_banned", { target_id: B, banned: true }],
    ["admin_set_user_banned", { target_id: B, banned: false }]]);
  expect(from).not.toHaveBeenCalled();
});
test("profile patch normalizes handles and preserves explicit nulls", async () => {
  await updateMySupabaseProfile({ username: " FOODIE ", displayName: " Foodie ", bio: null, avatarUrl: null });
  expect(pinnedRpc).toHaveBeenCalledWith("update_my_profile", { profile_patch: {
    username: "foodie", display_name: "Foodie", bio: null, avatar_path: null } });
  expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  expect(header).toHaveBeenCalledWith("Authorization", "Bearer test-access");
});
test("profile patch whitelists unknown JS fields", async () => {
  await updateMySupabaseProfile({ bio: "Hi", role: "admin", id: B } as never);
  expect(pinnedRpc).toHaveBeenCalledWith("update_my_profile", { profile_patch: { bio: "Hi" } });
});
test("invalid visible profile inputs never write", async () => {
  await expect(updateMySupabaseProfile({ username: "no spaces" })).rejects.toThrow("Username");
  await expect(updateMySupabaseProfile({ displayName: "x" })).rejects.toThrow("Name");
  await expect(updateMySupabaseProfile({ bio: "x".repeat(281) })).rejects.toThrow("280");
  expect(pinnedRpc).not.toHaveBeenCalled();
});
test("a switched account cannot receive a stale profile response", async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: A }, access_token: "test-access", refresh_token: "test-refresh" } } })
    .mockResolvedValueOnce({ data: { session: { user: { id: B } } } });
  await expect(updateMySupabaseProfile({ bio: "Hi" })).rejects.toThrow("account may have changed");
  expect(pinnedRpc).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
test("pinned client must belong to the captured identity", async () => {
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser: jest.fn()
    .mockResolvedValue({ data: { user: { id: B } }, error: null }) } });
  await expect(updateMySupabaseProfile({ bio: "Hi" })).rejects.toThrow("signed in");
  expect(pinnedRpc).not.toHaveBeenCalled();
});
test("unique username errors are friendly", async () => {
  header.mockResolvedValue({ data: null, error: { message: "DB unique error", code: "23505" } });
  await expect(updateMySupabaseProfile({ username: "foodie" })).rejects.toThrow("already taken");
});

test("same-account token rotation and late account switches discard profile replies", async () => {
  for (const session of [{ user: { id: B }, access_token: "other-token" },
    { user: { id: A }, access_token: "rotated-token" }]) {
    header.mockImplementationOnce(async () => {
      auth.getSession.mockResolvedValue({ data: { session } });
      return { data: [row], error: null };
    });
    await expect(updateMySupabaseProfile({ bio: "Hi" })).rejects.toThrow("account changed");
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: A }, access_token: "test-access" } } });
  }
});
test("search is passed as literal RPC text, not embedded in a filter", async () => {
  await searchSupabaseUsers(" @mar,role.eq.admin ");
  expect(rpc).toHaveBeenCalledWith("search_public_profiles", { search_text: "mar,role.eq.admin" });
  rpc.mockClear(); expect(await searchSupabaseUsers("@a")).toEqual([]); expect(rpc).not.toHaveBeenCalled();
});
test("suggestions use a bounded server query", async () => {
  expect(await getSupabaseSuggestedUsers(10000)).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("suggest_public_profiles", { result_limit: 100 });
  rpc.mockRejectedValue(new Error("Offline")); expect(await getSupabaseSuggestedUsers()).toEqual([]);
});
