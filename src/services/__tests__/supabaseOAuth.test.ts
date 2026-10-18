import * as WebBrowser from "expo-web-browser";
import { supabase } from "@/services/supabase";
import { getSupabaseCurrentUser } from "@/services/supabaseAuth";
import { completeSupabaseOAuthSignup, loginWithSupabaseGoogle } from "@/services/supabaseOAuth";

jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@/services/supabase", () => ({ supabase: {
  auth: { signInWithOAuth: jest.fn(), exchangeCodeForSession: jest.fn(), getUser: jest.fn(), signOut: jest.fn() },
  from: jest.fn(), rpc: jest.fn(),
} }));
jest.mock("@/services/supabaseAuth", () => ({ getSupabaseCurrentUser: jest.fn() }));
jest.mock("@/services/lastOAuth", () => ({ setLastOAuth: jest.fn() }));
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase, async () => "user-a"));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
let single: jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://project.supabase.co/auth/v1/authorize?code_challenge_method=s256" }, error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "user-a", email: "foodie@example.test", user_metadata: { full_name: "Foodie" } } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({ type: "success", url: "hiddenplate://auth?code=valid-code" });
  single = jest.fn().mockResolvedValue({ data: { is_banned: false, signup_pending: null }, error: null });
  (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single,
    limit: jest.fn().mockResolvedValue({ data: [], error: null }) }) }) });
  (getSupabaseCurrentUser as jest.Mock).mockResolvedValue({ id: "user-a", username: "foodie" });
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
});

test("Google uses PKCE exchange and the existing native auth route", async () => {
  expect(await loginWithSupabaseGoogle()).toMatchObject({ status: "authenticated", user: { id: "user-a" } });
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "hiddenplate://auth", skipBrowserRedirect: true } });
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
});
test.each([{ user_id: "user-a" }, [{ user_id: "user-a" }]].map(value => [value]))("new OAuth identity %j uses the existing username picker contract", async signup_pending => {
  single.mockResolvedValue({ data: { is_banned: false, signup_pending }, error: null });
  expect(await loginWithSupabaseGoogle()).toMatchObject({ status: "needs-username", suggestedUsername: "foodie", suggestedDisplayName: "Foodie" });
  expect(getSupabaseCurrentUser).not.toHaveBeenCalled();
  expect(supabase.from).toHaveBeenLastCalledWith("public_profiles");
});

test.each([null, []].map(value => [value]))("returning OAuth user with %j pending status skips username selection", async signup_pending => {
  single.mockResolvedValue({ data: { is_banned: false, signup_pending }, error: null });
  expect(await loginWithSupabaseGoogle()).toMatchObject({ status: "authenticated" });
});

test("missing pending status cannot silently finish OAuth signup", async () => {
  single.mockResolvedValue({ data: { is_banned: false }, error: null });
  await expect(loginWithSupabaseGoogle()).rejects.toThrow("signup status");
  expect(getSupabaseCurrentUser).not.toHaveBeenCalled();
});
test("cancelled browser sign-in does not exchange a code", async () => {
  (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({ type: "cancel" });
  await expect(loginWithSupabaseGoogle()).rejects.toMatchObject({ code: "oauth_cancelled" });
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
});
test("unsafe callback does not exchange a code", async () => {
  (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({ type: "success", url: "https://attacker.example?code=stolen" });
  await expect(loginWithSupabaseGoogle()).rejects.toThrow("Unexpected");
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
});
test("native OAuth refuses a plain PKCE fallback", async () => {
  auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://project.supabase.co/auth/v1/authorize?code_challenge_method=plain" }, error: null });
  await expect(loginWithSupabaseGoogle()).rejects.toMatchObject({ code: "pkce_unavailable" });
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
});
test("banned OAuth users are signed out locally", async () => {
  single.mockResolvedValue({ data: { is_banned: true, signup_pending: [] }, error: null });
  await expect(loginWithSupabaseGoogle()).rejects.toMatchObject({ code: "account_banned" });
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
test("profile completion is bound by the database RPC, not a supplied user ID", async () => {
  await completeSupabaseOAuthSignup({ username: " FOODIE ", displayName: " Foodie " });
  expect(supabase.rpc).toHaveBeenCalledWith("finish_auth_signup", { chosen_username: "foodie", chosen_display_name: "Foodie", chosen_avatar: null });
});
