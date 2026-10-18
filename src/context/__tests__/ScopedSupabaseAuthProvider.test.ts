import React, { useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AuthContext, AuthProvider, type AuthContextValue } from "@/context/AuthContext";
import * as authService from "@/services/auth";
import { getRuntimeSupabaseServices } from "@/services/backendRuntime";
import type { AuthSnapshot } from "@/utils/authSession";
import { SIGNED_OUT_SNAPSHOT } from "@/utils/authSession";

jest.mock("@/services/backendRuntime", () => ({ getRuntimeBackend: () => "supabase", getRuntimeSupabaseServices: jest.fn() }));
jest.mock("@/services/auth", () => ({ login: jest.fn(), signup: jest.fn(), logout: jest.fn(),
  loginWithGoogle: jest.fn(), loginWithApple: jest.fn(), completeOAuthSignup: jest.fn() }));
jest.mock("@/services/admin", () => ({ checkIsAdmin: jest.fn() }));
jest.mock("@/services/userPreferences", () => ({ getUserPreferences: jest.fn() }));
jest.mock("@/services/sentry", () => ({ identifyUser: jest.fn(), clearUser: jest.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const snapshot = (id: string, admin = false): AuthSnapshot => ({ user: { id, email: "fixture@example.test",
  username: id, displayName: id, avatarUrl: null, bio: null, createdAt: "fixture", isBanned: false },
  isAdmin: admin, needsOnboarding: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let renderer: ReactTestRenderer | undefined, value: AuthContextValue, client: QueryClient;
let onSnapshot: (next: AuthSnapshot) => void, onError: (error: unknown) => void;
const restore = jest.fn(), load = jest.fn(), unsubscribe = jest.fn(), subscribe = jest.fn();
let mounts: number, unmounts: number;
function Probe() {
  value = useContext(AuthContext)!;
  client = useQueryClient();
  useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
  return null;
}
async function mount(strict = false) {
  await act(async () => {
    const tree = React.createElement(AuthProvider, null, React.createElement(Probe));
    renderer = create(strict ? React.createElement(React.StrictMode, null, tree) : tree);
  });
}
let consoleError: jest.SpyInstance;
beforeEach(() => {
  jest.resetAllMocks(); mounts = 0; unmounts = 0;
  // React 19 deprecates this version-matched, test-only renderer. Do not hide
  // other console errors (including act warnings or real render failures).
  const original = console.error;
  consoleError = jest.spyOn(console, "error").mockImplementation((...args) => {
    if (String(args[0]).startsWith("react-test-renderer is deprecated.")) return;
    original(...args);
  });
  restore.mockResolvedValue({ ...SIGNED_OUT_SNAPSHOT });
  load.mockResolvedValue(snapshot("account-a"));
  subscribe.mockImplementation((publish, error) => { onSnapshot = publish; onError = error; return unsubscribe; });
  (getRuntimeSupabaseServices as jest.Mock).mockResolvedValue({ gateway: { load: async () => ({
    subscribeSupabaseAuthSnapshot: subscribe, restoreSupabaseAuthSnapshot: restore, loadSupabaseAuthSnapshot: load,
  }) } });
});
afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
  renderer = undefined;
  consoleError.mockRestore();
});

test("the actual AuthProvider Supabase branch mounts across its module cycle", async () => {
  restore.mockResolvedValue(snapshot("account-a", true));
  await mount();
  expect(value).toMatchObject({ isLoading: false, isAuthenticated: true, isAdmin: true, user: { id: "account-a" } });
  expect(subscribe).toHaveBeenCalledTimes(1);
});
test("account transitions clear old queries and remount local screen state", async () => {
  restore.mockResolvedValue(snapshot("account-a", true));
  await mount();
  const old = client, oldMounts = mounts;
  old.setQueryData(["private-inbox"], ["account-a-private"]);
  await act(async () => { onSnapshot(snapshot("account-b")); });
  expect(client).not.toBe(old);
  expect(old.getQueryData(["private-inbox"])).toBeUndefined();
  expect(client.getQueryData(["private-inbox"])).toBeUndefined();
  expect(mounts).toBe(oldMounts + 1);
  expect(unmounts).toBeGreaterThan(0);
  expect(value).toMatchObject({ user: { id: "account-b" }, isAdmin: false });
});
test("sign-out cancels in-flight private queries and does not admit late results", async () => {
  restore.mockResolvedValue(snapshot("account-a"));
  await mount();
  const old = client, request = deferred<string[]>();
  let aborted = false;
  const pending = old.fetchQuery({ queryKey: ["private"], queryFn: ({ signal }) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return request.promise;
  } }).catch(() => undefined);
  await act(async () => { onSnapshot({ ...SIGNED_OUT_SNAPSHOT }); });
  request.resolve(["stale-private"]);
  await pending;
  expect(aborted).toBe(true);
  expect(old.getQueryCache().getAll()).toHaveLength(0);
  expect(client.getQueryData(["private"])).toBeUndefined();
  expect(value).toMatchObject({ user: null, isAdmin: false, isAuthenticated: false });
});
test("a newer auth event supersedes delayed startup restoration", async () => {
  const delayed = deferred<AuthSnapshot>(); restore.mockReturnValue(delayed.promise);
  await mount();
  expect(value.isLoading).toBe(true);
  await act(async () => { onSnapshot(snapshot("account-b")); delayed.resolve(snapshot("account-a", true)); });
  expect(value).toMatchObject({ user: { id: "account-b" }, isAdmin: false, isLoading: false });
});
test("a newer event supersedes a delayed explicit refresh", async () => {
  restore.mockResolvedValue(snapshot("account-a")); await mount();
  const delayed = deferred<AuthSnapshot>(); load.mockReturnValue(delayed.promise);
  const pending = value.refresh();
  await act(async () => { onSnapshot(snapshot("account-b")); delayed.resolve(snapshot("account-a", true)); await pending; });
  expect(value).toMatchObject({ user: { id: "account-b" }, isAdmin: false });
});
test("banned snapshots clear the account and transient errors retain verified identity", async () => {
  restore.mockResolvedValue(snapshot("account-a")); await mount();
  await act(async () => { onError(new Error("temporary offline")); });
  expect(value.user?.id).toBe("account-a");
  const banned = snapshot("account-a", true); banned.user!.isBanned = true;
  await act(async () => { onSnapshot(banned); });
  expect(value).toMatchObject({ user: null, isAdmin: false });
});
test("strict-effect replay installs one live subscription and releases it on unmount", async () => {
  restore.mockResolvedValue(snapshot("account-a")); await mount(true);
  expect(value.user?.id).toBe("account-a");
  expect(subscribe.mock.calls.length - unsubscribe.mock.calls.length).toBe(1);
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  expect(subscribe.mock.calls.length - unsubscribe.mock.calls.length).toBe(0);
});
test("unmount before lazy loading completes does not subscribe or restore", async () => {
  const delayed = deferred<unknown>(); (getRuntimeSupabaseServices as jest.Mock).mockReturnValue(delayed.promise);
  await mount();
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  await act(async () => { delayed.resolve({ gateway: { load: async () => ({ subscribeSupabaseAuthSnapshot: subscribe, restoreSupabaseAuthSnapshot: restore }) } }); });
  expect(subscribe).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
});
test("concurrent account actions are rejected, and a failed action releases the guard", async () => {
  await mount();
  const delayed = deferred<void>(); (authService.login as jest.Mock).mockReturnValue(delayed.promise);
  const pending = value.login({ email: "fixture@example.test", password: "fixture-only" });
  await expect(value.logout()).rejects.toThrow("Another account action");
  await act(async () => { delayed.resolve(); await pending; });
  (authService.logout as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  await expect(value.logout()).rejects.toThrow("offline");
  load.mockResolvedValue({ ...SIGNED_OUT_SNAPSHOT });
  await act(async () => { await value.logout(); });
  expect(value.user).toBeNull();
});
test("a delayed logout completion cannot clear a newer account", async () => {
  restore.mockResolvedValue(snapshot("account-a")); await mount();
  const delayed = deferred<void>(); (authService.logout as jest.Mock).mockReturnValue(delayed.promise);
  const pending = value.logout();
  load.mockResolvedValue(snapshot("account-b"));
  await act(async () => { onSnapshot(snapshot("account-b")); delayed.resolve(); await pending; });
  expect(value.user?.id).toBe("account-b");
});
test("a failed startup load ends loading without publishing an unverified account", async () => {
  restore.mockRejectedValue(new Error("offline")); await mount();
  expect(value).toMatchObject({ user: null, isAdmin: false, isLoading: false });
});
test("retired in-flight queries do not leave detached 24-hour GC timers", async () => {
  restore.mockResolvedValue(snapshot("account-a")); await mount();
  jest.useFakeTimers();
  try {
    const delayed = deferred<string>(), old = client;
    const pending = old.fetchQuery({ queryKey: ["retired"], queryFn: () => delayed.promise }).catch(() => undefined);
    await act(async () => { onSnapshot({ ...SIGNED_OUT_SNAPSHOT }); await pending; });
    // Flush zero-delay notification/microtasks without advancing a GC deadline.
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(old.getQueryCache().getAll()).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
    delayed.resolve("discarded");
  } finally { jest.useRealTimers(); }
});
