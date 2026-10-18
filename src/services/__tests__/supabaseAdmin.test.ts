import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { checkSupabaseIsAdmin, getSupabaseAdminCoreStats } from "@/services/supabaseAdmin";
jest.mock("@/services/supabase", () => ({ supabase: { auth: { getUser: jest.fn(), getSession: jest.fn() }, rpc: jest.fn(), from: jest.fn() }, createIsolatedSupabaseAuthClient: jest.fn() }));
const auth = supabase.auth as unknown as Record<string,jest.Mock>;
const rpc = supabase.rpc as jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: "admin-a" } }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "admin-a" }, access_token: "fixture-admin-token" } }, error: null });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser: auth.getUser },
    rpc: (...args: unknown[]) => ({ setHeader: () => rpc(...args) }) });
  rpc.mockResolvedValue({ data: true, error: null });
});
test("uses server-owned admin authorization", async () => {
  expect(await checkSupabaseIsAdmin()).toBe(true); expect(rpc).toHaveBeenCalledWith("is_admin");
});
test("signed-out, banned/server-false and offline checks fail closed", async () => {
  rpc.mockResolvedValue({ data: false, error: null }); expect(await checkSupabaseIsAdmin()).toBe(false);
  rpc.mockRejectedValue(new Error("Offline")); expect(await checkSupabaseIsAdmin()).toBe(false);
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null }); rpc.mockClear();
  expect(await checkSupabaseIsAdmin()).toBe(false); expect(rpc).not.toHaveBeenCalled();
});
test("account switching discards previous admin authority", async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "member-b" } } }, error: null });
  expect(await checkSupabaseIsAdmin()).toBe(false);
});
test("dashboard counts cannot run without admin access", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  await expect(getSupabaseAdminCoreStats()).rejects.toThrow("Admin access required.");
  expect(supabase.from).not.toHaveBeenCalled();
});
