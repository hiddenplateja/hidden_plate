import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { clearCurrentSupabasePushToken, registerForSupabasePushNotifications } from "@/services/supabasePushTokens";
import { AbortController as NativeAbortController, AbortSignal as NativeAbortSignal } from "abort-controller";

jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: {
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
} }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "project-id" } } } } }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => ({ AndroidImportance: { MAX: 5 },
  setNotificationChannelAsync: jest.fn(), getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(), getExpoPushTokenAsync: jest.fn(),
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@/services/supabase", () => ({ supabase: { auth: { getUser: jest.fn(), getSession: jest.fn() }, from: jest.fn() }, createIsolatedSupabaseAuthClient: jest.fn() }));
const proof = jest.fn(), rpc = jest.fn(), isolatedFrom = jest.fn();
const rpcAbort = jest.fn(), rpcHeader = jest.fn();
const deleteAbort = jest.fn(), deleteHeader = jest.fn(), secondEq = jest.fn(), firstEq = jest.fn(), remove = jest.fn();
let active = "user-a";
const originalController = global.AbortController, originalSignal = global.AbortSignal;
beforeAll(() => {
  global.AbortController = NativeAbortController as unknown as typeof AbortController;
  global.AbortSignal = NativeAbortSignal as unknown as typeof AbortSignal;
});
afterAll(() => { global.AbortController = originalController; global.AbortSignal = originalSignal; });

beforeEach(() => {
  jest.resetAllMocks();
  (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  active = "user-a";
  (supabase.auth.getSession as jest.Mock).mockImplementation(async () => ({ data: { session: { user: { id: active }, access_token: `token-${active}` } } }));
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser: proof }, rpc, from: isolatedFrom });
  proof.mockImplementation(async token => ({ data: { user: { id: token.slice(6) } }, error: null }));
  rpcAbort.mockResolvedValue({ error: null }); rpcHeader.mockReturnValue({ abortSignal: rpcAbort }); rpc.mockReturnValue({ setHeader: rpcHeader });
  deleteAbort.mockResolvedValue({ error: null }); deleteHeader.mockReturnValue({ abortSignal: deleteAbort });
  secondEq.mockReturnValue({ setHeader: deleteHeader }); firstEq.mockReturnValue({ eq: secondEq }); remove.mockReturnValue({ eq: firstEq });
  isolatedFrom.mockReturnValue({ delete: remove });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: "ExponentPushToken[test-device]" });
});
test("registers the device token after channel setup, not an arbitrary user ID", async () => {
  expect(await registerForSupabasePushNotifications()).toBe("ExponentPushToken[test-device]");
  expect(rpc).toHaveBeenCalledWith("register_push_token", { push_token: "ExponentPushToken[test-device]", device_platform: "android" });
  expect(rpcHeader).toHaveBeenCalledWith("Authorization", "Bearer token-user-a");
  expect(supabase.from).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith("hidden-plate:supabase:push:user-a", "ExponentPushToken[test-device]");
  expect((Notifications.setNotificationChannelAsync as jest.Mock).mock.invocationCallOrder[0])
    .toBeLessThan((Notifications.getPermissionsAsync as jest.Mock).mock.invocationCallOrder[0]);
});
test("legacy user-ID argument cannot register after the provider's account became stale", async () => {
  expect(await registerForSupabasePushNotifications("user-b")).toBeNull();
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  expect(await registerForSupabasePushNotifications("user-a")).toBe("ExponentPushToken[test-device]");
});
test("permission denial does not request or register a token", async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
  expect(await registerForSupabasePushNotifications()).toBeNull();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
test("an account switch during token retrieval discards registration", async () => {
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementation(async () => { active = "user-b"; return { data: "ExponentPushToken[test-device]" }; });
  expect(await registerForSupabasePushNotifications()).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});
test("logout token deletion is constrained to this owner and this device", async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue("ExponentPushToken[test-device]");
  await clearCurrentSupabasePushToken();
  expect(isolatedFrom).toHaveBeenCalledWith("push_tokens");
  expect(firstEq).toHaveBeenCalledWith("user_id", "user-a");
  expect(secondEq).toHaveBeenCalledWith("token", "ExponentPushToken[test-device]");
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hidden-plate:supabase:push:user-a");
  expect(deleteHeader).toHaveBeenCalledWith("Authorization", "Bearer token-user-a");
});

test("an account switch during registration triggers owner-scoped old token cleanup", async () => {
  rpcAbort.mockImplementation(async () => { active = "user-b"; return { error: null }; });
  expect(await registerForSupabasePushNotifications()).toBeNull();
  expect(firstEq).toHaveBeenCalledWith("user_id", "user-a"); expect(deleteHeader).toHaveBeenCalledWith("Authorization", "Bearer token-user-a");
  expect(AsyncStorage.setItem).toHaveBeenCalledWith("hidden-plate:supabase:push:user-a", "ExponentPushToken[test-device]");
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hidden-plate:supabase:push:user-a");
});
test("new registration waits for old in-flight registration and cleanup", async () => {
  let release!: () => void; let started!: () => void;
  const inFlight = new Promise<void>(resolve => { started = resolve; });
  rpcAbort.mockImplementationOnce(async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return { error: null }; });
  const old = registerForSupabasePushNotifications(); await inFlight; active = "user-b";
  const next = registerForSupabasePushNotifications(); await new Promise(resolve => setImmediate(resolve));
  expect(rpc).toHaveBeenCalledTimes(1); release(); expect(await old).toBeNull();
  expect(await next).toBe("ExponentPushToken[test-device]"); expect(rpc).toHaveBeenCalledTimes(2);
  expect(deleteAbort.mock.invocationCallOrder[0]).toBeLessThan(rpcAbort.mock.invocationCallOrder[1]);
  expect(rpcHeader).toHaveBeenLastCalledWith("Authorization", "Bearer token-user-b");
});
test("permission/native failures do not leak or strand the registration queue", async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error("native permission failure"));
  expect(await registerForSupabasePushNotifications()).toBeNull();
  expect(await registerForSupabasePushNotifications()).toBe("ExponentPushToken[test-device]");
});
test("revoked proof cannot prompt permissions or mutate registration", async () => {
  proof.mockResolvedValue({ data: { user: null }, error: new Error("revoked") });
  expect(await registerForSupabasePushNotifications()).toBeNull(); expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
test("queued cleanup cannot adopt a new user's session and failed delete keeps retry key", async () => {
  await clearCurrentSupabasePushToken({ userId: "user-b", accessToken: "token-user-b" }); expect(remove).not.toHaveBeenCalled();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue("ExponentPushToken[test-device]"); deleteAbort.mockResolvedValue({ error: new Error("offline") });
  await clearCurrentSupabasePushToken(); expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});
test("local token storage failure aborts before database registration", async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("disk unavailable"));
  expect(await registerForSupabasePushNotifications()).toBeNull(); expect(rpc).not.toHaveBeenCalled();
});
