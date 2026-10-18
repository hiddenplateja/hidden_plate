import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { getSupabaseCurrentUser } from "@/services/supabaseAuth";
import { completeSupabaseOAuthSignup } from "@/services/supabaseOAuth";
import { recordSupabaseSession } from "@/services/supabaseSessionFence";
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@/services/supabase", () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() }, createIsolatedSupabaseAuthClient: jest.fn() }));
jest.mock("@/services/supabaseAuth", () => ({ getSupabaseCurrentUser: jest.fn() }));
jest.mock("@/services/lastOAuth", () => ({ setLastOAuth: jest.fn() }));
const A = { user: { id: "fixture-a" }, access_token: "fixture-token-a" };
const B = { user: { id: "fixture-b" }, access_token: "fixture-token-b" };
const input = { username: " FOODIE ", displayName: " Foodie " };
const getUser = jest.fn(), rpc = jest.fn(), header = jest.fn(), setSession = jest.fn(), signOut = jest.fn();
function transition(session: typeof A | null) {
  recordSupabaseSession(session);
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session }, error: null });
}
beforeEach(() => {
  jest.resetAllMocks(); transition(null); transition(A);
  getUser.mockResolvedValue({ data: { user: { id: "fixture-a" } }, error: null });
  rpc.mockReturnValue({ setHeader: header }); header.mockResolvedValue({ error: null });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser, setSession, signOut }, rpc });
  (getSupabaseCurrentUser as jest.Mock).mockResolvedValue({ id: "fixture-a", username: "foodie" });
  (supabase.rpc as jest.Mock).mockImplementation(() => { throw new Error("Shared credentials must not be used"); });
});
test("pending-profile completion uses its verified token without installing another session", async () => {
  expect(await completeSupabaseOAuthSignup(input)).toMatchObject({ id: "fixture-a" });
  expect(rpc).toHaveBeenCalledWith("finish_auth_signup", { chosen_username: "foodie", chosen_display_name: "Foodie", chosen_avatar: null });
  expect(header).toHaveBeenCalledWith("Authorization", "Bearer fixture-token-a");
  expect(setSession).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
});
test("a switch during identity proof prevents profile completion", async () => {
  getUser.mockImplementationOnce(async () => { transition(B); return { data: { user: { id: "fixture-a" } } }; });
  await expect(completeSupabaseOAuthSignup(input)).rejects.toThrow("session changed");
  expect(rpc).not.toHaveBeenCalled();
});
test("completion cannot publish success from a late previous-account response", async () => {
  header.mockImplementationOnce(async () => { transition(B); return { error: null }; });
  await expect(completeSupabaseOAuthSignup(input)).rejects.toThrow("session changed");
  expect(getSupabaseCurrentUser).not.toHaveBeenCalled();
});
test("a switch while loading the completed user cannot return the replacement profile", async () => {
  (getSupabaseCurrentUser as jest.Mock).mockImplementationOnce(async () => { transition(B); return { id: "fixture-b" }; });
  await expect(completeSupabaseOAuthSignup(input)).rejects.toThrow("session changed");
});
test("a mismatched profile is rejected even when session metadata stays unchanged", async () => {
  (getSupabaseCurrentUser as jest.Mock).mockResolvedValueOnce({ id: "fixture-b" });
  await expect(completeSupabaseOAuthSignup(input)).rejects.toMatchObject({ code: "session_changed" });
});
