// Exercise the real shared-client observer wiring, with SDK/native APIs mocked.
let original: NodeJS.ProcessEnv;
beforeEach(() => {
  jest.resetModules(); original = { ...process.env };
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
  jest.doMock("react-native-url-polyfill/auto", () => ({}));
  jest.doMock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: {} }));
  jest.doMock("react-native", () => ({ Platform: { OS: "android" } }));
  jest.doMock("@/services/supabaseNativeCrypto", () => ({ installNativeAuthCrypto: jest.fn() }));
});
afterEach(() => { process.env = original; });
test("the shared client records auth transitions synchronously without SDK calls in the callback", () => {
  const getSession = jest.fn(), onAuthStateChange = jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const shared = { auth: { getSession, onAuthStateChange } }, isolated = { auth: {} };
  const createClient = jest.fn().mockReturnValueOnce(shared).mockReturnValue(isolated);
  jest.doMock("@supabase/supabase-js", () => ({ createClient, processLock: jest.fn() }));
  const module = jest.requireActual("@/services/supabase") as typeof import("@/services/supabase");
  const fence = jest.requireActual("@/services/supabaseSessionFence") as typeof import("@/services/supabaseSessionFence");
  expect(onAuthStateChange).toHaveBeenCalledTimes(1);
  const callback = onAuthStateChange.mock.calls[0][0];
  const initial = fence.captureSupabaseSessionRevision();
  expect(callback("INITIAL_SESSION", null)).toBeUndefined();
  expect(fence.captureSupabaseSessionRevision()).toBe(initial);
  const session = { user: { id: "fixture-a" }, access_token: "fixture-token-a" };
  callback("SIGNED_IN", session);
  const signedIn = fence.captureSupabaseSessionRevision(); expect(signedIn).toBe(initial + 1);
  callback("SIGNED_IN", session); expect(fence.captureSupabaseSessionRevision()).toBe(signedIn);
  callback("TOKEN_REFRESHED", { ...session, access_token: "fixture-rotated" });
  expect(fence.captureSupabaseSessionRevision()).toBe(signedIn + 1);
  callback("SIGNED_OUT", null); expect(fence.captureSupabaseSessionRevision()).toBe(signedIn + 2);
  expect(getSession).not.toHaveBeenCalled();
  expect(module.createIsolatedSupabaseAuthClient()).toBe(isolated);
  expect(onAuthStateChange).toHaveBeenCalledTimes(1);
  expect(createClient.mock.calls[1][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
});
