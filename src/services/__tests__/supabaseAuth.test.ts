import { supabase } from "@/services/supabase";
import { SIGNED_OUT_SNAPSHOT } from "@/utils/authSession";
import { getSupabaseCurrentUser, loadSupabaseAuthSnapshot, loginWithSupabase,
  logoutFromSupabase, signupWithSupabase, subscribeSupabaseAuthSnapshot, confirmSupabaseEmailVerified } from "@/services/supabaseAuth";

jest.mock("@/services/supabase", () => ({ supabase: {
  auth: { getSession: jest.fn(), getUser: jest.fn(), signInWithPassword: jest.fn(),
    signUp: jest.fn(), signOut: jest.fn(), onAuthStateChange: jest.fn() },
  from: jest.fn(),
} }));
jest.mock("@/services/supabaseSessionLifecycle", () => ({ acquireSupabaseSessionRefresh: jest.fn(() => jest.fn()) }));
jest.mock("@/services/supabasePushTokens", () => ({ clearCurrentSupabasePushToken: jest.fn() }));
jest.mock("@/services/supabaseEmailAuth", () => ({ completeSupabaseEmailSignup: jest.fn() }));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;

test("raw account changes clear restored identity before the first deferred profile load", () => {
  jest.useFakeTimers();
  jest.requireMock("@/services/supabaseSessionLifecycle").acquireSupabaseSessionRefresh.mockReturnValue(jest.fn());
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const snapshots = jest.fn();
  const stop = subscribeSupabaseAuthSnapshot(snapshots);
  const callback = auth.onAuthStateChange.mock.calls[0][0];
  callback("INITIAL_SESSION", { user: { id: "user-a" } });
  callback("SIGNED_IN", { user: { id: "user-b" } });
  expect(snapshots).toHaveBeenCalledWith({ ...SIGNED_OUT_SNAPSHOT });
  expect(from).not.toHaveBeenCalled();
  stop(); jest.useRealTimers();
});

test("email confirmation checks Auth proof instead of setting a client-controlled flag", async () => {
  await expect(confirmSupabaseEmailVerified()).resolves.toBeUndefined();
  expect(auth.getUser).toHaveBeenCalledWith("token-a");
  expect(supabase.from).not.toHaveBeenCalled();
});
test("unverified email and signed-out sessions cannot pass confirmation", async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: "user-a", email_confirmed_at: null } }, error: null });
  await expect(confirmSupabaseEmailVerified()).rejects.toMatchObject({ code: "verification_required" });
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(confirmSupabaseEmailVerified()).rejects.toMatchObject({ code: "verification_required" });
});
test("email confirmation rejects stale or mismatched identity proofs", async () => {
  auth.getUser.mockResolvedValueOnce({ data: { user: { id: "user-b", email_confirmed_at: "confirmed" } }, error: null });
  await expect(confirmSupabaseEmailVerified()).rejects.toMatchObject({ code: "verification_required" });
  auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "user-a" }, access_token: "token-a" } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: "user-a" }, access_token: "replacement-token" } }, error: null });
  await expect(confirmSupabaseEmailVerified()).rejects.toMatchObject({ code: "session_changed" });
});
const from = supabase.from as jest.Mock;
const session = { user: { id: "user-a" }, access_token: "token-a" };
const profile = { id: "user-a", username: "foodie", display_name: "Foodie", avatar_path: null,
  bio: null, created_at: "2026-10-06", is_banned: false, role: "admin", signup_pending: null, preferences: { onboardingPending: true } };
let single: jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  jest.requireMock("@/services/supabasePushTokens").clearCurrentSupabasePushToken.mockResolvedValue(undefined);
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "user-a", email: "private@example.test", email_confirmed_at: "2026-10-06" } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-a" }, session }, error: null });
  single = jest.fn().mockResolvedValue({ data: profile, error: null });
  from.mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single,
    limit: jest.fn().mockResolvedValue({ data: [], error: null }) }) }) });
});

test("signed-out restore does not query profiles or make a user request", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  expect(await getSupabaseCurrentUser()).toBeNull();
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
});
test("loads identity, role and onboarding through one profile request", async () => {
  const state = await loadSupabaseAuthSnapshot();
  expect(state).toMatchObject({ isAdmin: true, needsOnboarding: true,
    user: { id: "user-a", username: "foodie", email: "private@example.test", emailVerified: true } });
  expect(from).toHaveBeenCalledTimes(1);
});

test("auth profile resolves an R2 key without changing the user contract", async () => {
  const previous=process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL="https://media.example.test";
  try {
    single.mockResolvedValue({data:{...profile,avatar_path:"usr/user-a/avatar.jpg"},error:null});
    expect((await loadSupabaseAuthSnapshot()).user?.avatarUrl).toBe("https://media.example.test/media/usr/user-a/avatar.jpg");
  } finally {
    if (previous===undefined) delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL; else process.env.EXPO_PUBLIC_MEDIA_WORKER_URL=previous;
  }
});
test("network failures are not mistaken for a definitive missing session", async () => {
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Network offline", status: 0 } });
  await expect(loadSupabaseAuthSnapshot()).rejects.toThrow("Network offline");
});
test("profile load failures surface a recoverable error", async () => {
  single.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
  await expect(getSupabaseCurrentUser()).rejects.toMatchObject({ code: "profile_unavailable" });
});
test("discards a previous account's delayed profile response", async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: "user-b" } } }, error: null });
  expect(await getSupabaseCurrentUser()).toBeNull();
});
test("email normalization never alters the password", async () => {
  await loginWithSupabase({ email: " FOODIE@Example.test ", password: "  exact Password  " });
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "foodie@example.test", password: "  exact Password  " });
});
test("login cannot return a different account after a concurrent session switch", async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "token-b" } } });
  auth.getUser.mockResolvedValue({ data: { user: { id: "user-b" } } }); single.mockResolvedValue({ data: { ...profile, id: "user-b" } });
  await expect(loginWithSupabase({ email: "user@example.test", password: "Password 123!" })).rejects.toMatchObject({ code: "session_changed" });
  expect(auth.signOut).not.toHaveBeenCalled();
});
test("banned login cleanup does not sign out a new session after profile load", async () => {
  single.mockResolvedValue({ data: { ...profile, is_banned: true } });
  auth.getSession.mockResolvedValueOnce({ data: { session } }).mockResolvedValueOnce({ data: { session } })
    .mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "token-b" } } });
  await expect(loginWithSupabase({ email: "user@example.test", password: "Password 123!" })).rejects.toMatchObject({ code: "account_banned" });
  expect(auth.signOut).not.toHaveBeenCalled();
});
test("banned users cannot log in or receive an admin client flag", async () => {
  single.mockResolvedValue({ data: { ...profile, is_banned: true }, error: null });
  expect((await loadSupabaseAuthSnapshot()).isAdmin).toBe(false);
  await expect(loginWithSupabase({ email: "user@example.test", password: "Password 123!" })).rejects.toMatchObject({ code: "account_banned" });
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
test("signup requires the verified email wizard instead of a second signUp call", async () => {
  jest.requireMock("@/services/supabaseEmailAuth").completeSupabaseEmailSignup
    .mockRejectedValue(new Error("Verify your email before creating your account."));
  await expect(signupWithSupabase({ email: "new@example.test", password: "NotACommonPass!", username: "new_user", displayName: "New User" }))
    .rejects.toThrow("Verify your email");
  expect(auth.signUp).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
});
test.each([{ user_id: "user-a" }, [{ user_id: "user-a" }]].map(value => [value]))("pending signup %j cannot enter onboarding or receive admin permissions", async signup_pending => {
  single.mockResolvedValue({ data: { ...profile, signup_pending }, error: null });
  expect(await loadSupabaseAuthSnapshot()).toEqual(SIGNED_OUT_SNAPSHOT);
});
test.each([null, []].map(value => [value]))("completed signup %j restores normally", async signup_pending => {
  single.mockResolvedValue({ data: { ...profile, signup_pending }, error: null });
  expect((await getSupabaseCurrentUser())?.id).toBe("user-a");
});
test("malformed pending status fails closed instead of entering onboarding", async () => {
  single.mockResolvedValue({ data: { ...profile, signup_pending: {} }, error: null });
  await expect(loadSupabaseAuthSnapshot()).rejects.toThrow("signup status");
});
test("logout is local to this device, not all sessions", async () => {
  await logoutFromSupabase();
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
test("push cleanup failure cannot prevent sign-out", async () => {
  const { clearCurrentSupabasePushToken } = jest.requireMock("@/services/supabasePushTokens");
  clearCurrentSupabasePushToken.mockRejectedValue(new Error("Offline"));
  await logoutFromSupabase();
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
test("auth callback defers database work and unsubscribes cleanly", async () => {
  jest.useFakeTimers();
  const unsubscribe = jest.fn();
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
  // resetAllMocks resets the lifecycle mock implementation too.
  const { acquireSupabaseSessionRefresh } = jest.requireMock("@/services/supabaseSessionLifecycle");
  const release = jest.fn(); acquireSupabaseSessionRefresh.mockReturnValue(release);
  const onSnapshot = jest.fn();
  const stop = subscribeSupabaseAuthSnapshot(onSnapshot);
  const callback = auth.onAuthStateChange.mock.calls[0][0];
  callback("SIGNED_IN", session);
  expect(auth.getSession).not.toHaveBeenCalled();
  callback("SIGNED_OUT", null);
  await jest.runAllTimersAsync();
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  expect(onSnapshot).toHaveBeenCalledWith({ user: null, isAdmin: false, needsOnboarding: false });
  stop(); expect(unsubscribe).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("logout does not sign out a different account that appears during device cleanup", async () => {
  const { clearCurrentSupabasePushToken } = jest.requireMock("@/services/supabasePushTokens");
  clearCurrentSupabasePushToken.mockImplementation(async () => { auth.getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "token-b" } } }); });
  await expect(logoutFromSupabase()).rejects.toMatchObject({ code: "session_changed" });
  expect(clearCurrentSupabasePushToken).toHaveBeenCalledWith({ userId: "user-a", accessToken: "token-a" }); expect(auth.signOut).not.toHaveBeenCalled();
});
test("a new session for the same user cannot be signed out by delayed logout", async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session } }).mockResolvedValue({ data: { session: { ...session, access_token: "new-token-a" } } });
  await expect(logoutFromSupabase()).rejects.toMatchObject({ code: "session_changed" }); expect(auth.signOut).not.toHaveBeenCalled();
});
test("hung device cleanup does not extend logout beyond its two-second wait", async () => {
  jest.useFakeTimers(); jest.requireMock("@/services/supabasePushTokens").clearCurrentSupabasePushToken.mockReturnValue(new Promise(() => {}));
  const result = logoutFromSupabase(); await jest.advanceTimersByTimeAsync(2000); await result;
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" }); jest.useRealTimers();
});
test("already signed-out logout makes no cleanup or sign-out call", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } }); await logoutFromSupabase();
  expect(auth.signOut).not.toHaveBeenCalled(); expect(jest.requireMock("@/services/supabasePushTokens").clearCurrentSupabasePushToken).not.toHaveBeenCalled();
});
test("profile identity mismatch and failed final session check cannot publish roles", async () => {
  single.mockResolvedValue({ data: { ...profile, id: "user-b" }, error: null });
  await expect(loadSupabaseAuthSnapshot()).rejects.toMatchObject({ code: "profile_unavailable" });
  single.mockResolvedValue({ data: profile }); auth.getSession.mockResolvedValueOnce({ data: { session } }).mockResolvedValue({ data: { session }, error: new Error("storage unavailable") });
  expect(await loadSupabaseAuthSnapshot()).toEqual({ user: null, isAdmin: false, needsOnboarding: false });
});
test("account transition clears old published role/profile synchronously before loading the new profile", async () => {
  jest.useFakeTimers(); const unsubscribe = jest.fn(); auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
  jest.requireMock("@/services/supabaseSessionLifecycle").acquireSupabaseSessionRefresh.mockReturnValue(jest.fn());
  const snapshots = jest.fn(); const stop = subscribeSupabaseAuthSnapshot(snapshots); const callback = auth.onAuthStateChange.mock.calls[0][0];
  callback("SIGNED_IN", session); await jest.runAllTimersAsync(); expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ isAdmin: true }));
  callback("SIGNED_IN", { user: { id: "user-b" } });
  expect(snapshots).toHaveBeenLastCalledWith({ user: null, isAdmin: false, needsOnboarding: false });
  stop(); await jest.runAllTimersAsync(); expect(snapshots).toHaveBeenCalledTimes(2); jest.useRealTimers();
});
