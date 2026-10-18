import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { currentSupabaseSessionIdentity, pinSupabaseSession } from "@/services/supabasePinnedSession";
jest.mock("@/services/supabase", () => ({ supabase: { auth: { getSession: jest.fn() } }, createIsolatedSupabaseAuthClient: jest.fn() }));
const proof = jest.fn(), setSession = jest.fn(), signOut = jest.fn();
const session = { user: { id: "user-a" }, access_token: "fixture-token-a" };
beforeEach(() => {
  jest.resetAllMocks(); (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session } });
  proof.mockResolvedValue({ data: { user: { id: "user-a" } } });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser: proof, setSession, signOut } });
});
test("pinned requests verify exact token without installing or revoking sessions", async () => {
  expect(await pinSupabaseSession()).toMatchObject({ userId: "user-a", accessToken: "fixture-token-a" });
  expect(proof).toHaveBeenCalledWith("fixture-token-a"); expect(setSession).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
});
test("missing session and revoked/mismatched network proof fail closed", async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null } }); expect(await pinSupabaseSession()).toBeNull();
  proof.mockResolvedValue({ data: { user: { id: "user-b" } } }); expect(await pinSupabaseSession()).toBeNull();
  proof.mockResolvedValue({ data: { user: null }, error: new Error("revoked") }); expect(await pinSupabaseSession()).toBeNull();
});
test("account/token change after proof cannot create a pinned request", async () => {
  for (const current of [{ user: { id: "user-b" }, access_token: "fixture-token-b" }, { ...session, access_token: "replacement-token-a" }]) {
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session } }).mockResolvedValueOnce({ data: { session: current } });
    expect(await pinSupabaseSession()).toBeNull();
  }
});
test("session read failure is an error rather than authoritative sign-out", async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null }, error: new Error("offline") });
  await expect(currentSupabaseSessionIdentity()).rejects.toThrow("Couldn't check");
});
