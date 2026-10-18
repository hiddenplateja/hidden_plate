import React, { useContext } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as Notifications from "expo-notifications";
import { NotificationContext, NotificationProvider, type NotificationContextValue } from "@/components/NotificationProvider";
import { useAuth } from "@/hooks/useAuth";
import { recordSupabaseSession } from "@/services/supabaseSessionFence";
import { getUnreadCount, listMyNotifications, markAllRead } from "@/services/notifications";
import { registerForPushNotifications } from "@/services/pushTokens";
import { verifySupabasePushEvent } from "@/services/supabasePushEvents";

jest.mock("expo-notifications", () => ({ setNotificationHandler: jest.fn(), addNotificationReceivedListener: jest.fn(), addNotificationResponseReceivedListener: jest.fn(), getLastNotificationResponseAsync: jest.fn(), clearLastNotificationResponseAsync: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => router }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/services/backendRuntime", () => ({ getRuntimeBackend: () => mode }));
jest.mock("@/services/notifications", () => ({ listMyNotifications: jest.fn(), getUnreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(), deleteNotification: jest.fn() }));
jest.mock("@/services/pushTokens", () => ({ registerForPushNotifications: jest.fn() }));
jest.mock("@/services/supabasePushEvents", () => ({ ...jest.requireActual("@/services/supabasePushEvents"), verifySupabasePushEvent: jest.fn() }));
const handler = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];
const router = { push: jest.fn() }, removeReceived = jest.fn(), removeResponse = jest.fn();
const A = "fa000000-0000-4000-8000-000000000001", B = "fa000000-0000-4000-8000-000000000002";
const row = (userId: string) => ({ id: userId, userId, actorId: "actor", type: "comment", title: "Fixture", body: "Fixture", data: { postId: B }, isRead: false, createdAt: "fixture" });
let mode: "supabase" | "appwrite", value: NotificationContextValue, renderer: ReactTestRenderer | undefined;
let received: (event: unknown) => void, response: (event: unknown) => void;
const receivedEvent = { request: { identifier: "fixture-native-event", content: { data: { notificationId: A, postId: "untrusted-path" } } } };
const responseEvent = { notification: receivedEvent };
function Probe() { value = useContext(NotificationContext)!; return null; }
function tree() { return React.createElement(NotificationProvider, null, React.createElement(Probe)); }
function transition(id: string) {
  recordSupabaseSession({ user: { id }, access_token: `fixture-${id}` });
  (useAuth as jest.Mock).mockReturnValue({ user: { id } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function mount(strict = false) { await act(async () => { renderer = create(strict ? React.createElement(React.StrictMode, null, tree()) : tree()); }); }
let consoleError: jest.SpyInstance;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  jest.resetAllMocks(); mode = "supabase"; transition(A);
  const original = console.error;
  consoleError = jest.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).startsWith("react-test-renderer is deprecated.")) original(...args);
  });
  (listMyNotifications as jest.Mock).mockImplementation(async () => ({ items: [row((useAuth as jest.Mock)().user.id)], total: 1, hasMore: false, nextCursor: null }));
  (getUnreadCount as jest.Mock).mockResolvedValue(1);
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
  (Notifications.clearLastNotificationResponseAsync as jest.Mock).mockResolvedValue(undefined);
  (registerForPushNotifications as jest.Mock).mockImplementation(async id => `token-${id}`);
  (verifySupabasePushEvent as jest.Mock).mockResolvedValue(row(A));
  (Notifications.addNotificationReceivedListener as jest.Mock).mockImplementation(callback => { received = callback; return { remove: removeReceived }; });
  (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(callback => { response = callback; return { remove: removeResponse }; });
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; consoleError.mockRestore(); });

test("the real provider branch/context cycle mounts without changing its public contract", async () => {
  await mount(); expect(value.notifications[0].userId).toBe(A); expect(value.unreadCount).toBe(1);
  expect(value.pushToken).toBe(`token-${A}`);
});
test("late account-A inbox and push-registration results cannot replace account B", async () => {
  const inbox = deferred<unknown>(), registration = deferred<string>();
  (listMyNotifications as jest.Mock).mockReturnValueOnce(inbox.promise);
  (registerForPushNotifications as jest.Mock).mockReturnValueOnce(registration.promise);
  await mount();
  await act(async () => { transition(B); renderer!.update(tree()); });
  await act(async () => { inbox.resolve({ items: [row(A)], hasMore: false, nextCursor: null }); registration.resolve("old-token"); });
  expect(value.notifications.map(item => item.userId)).toEqual([B]); expect(value.pushToken).toBe(`token-${B}`);
});
test("old mutation callbacks cannot act on the replacement account", async () => {
  await mount(); const oldMarkAll = value.markAllAsRead;
  await act(async () => { transition(B); renderer!.update(tree()); });
  await act(async () => { await oldMarkAll(); });
  expect(markAllRead).not.toHaveBeenCalled(); expect(value.unreadCount).toBe(1);
});
test("removed/queued listeners cannot verify or route after an account transition", async () => {
  await mount(); const oldReceived = received, oldResponse = response;
  await act(async () => { transition(B); renderer!.update(tree()); });
  await act(async () => { oldReceived(receivedEvent); oldResponse(responseEvent); });
  expect(verifySupabasePushEvent).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  expect(removeReceived).toHaveBeenCalled(); expect(removeResponse).toHaveBeenCalled();
});
test("tap routing uses the verified inbox row, not raw deep-link fields", async () => {
  await mount(); await act(async () => { response(responseEvent); });
  expect(router.push).toHaveBeenCalledWith(`/post/${B}`);
});
test("cold-start responses are verified and live/startup duplicates navigate once", async () => {
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValueOnce(responseEvent);
  await mount(); await act(async () => { response(responseEvent); });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
});
test("late cold-start responses from the previous account are ignored", async () => {
  const delayed = deferred<unknown>(); (Notifications.getLastNotificationResponseAsync as jest.Mock).mockReturnValueOnce(delayed.promise);
  await mount();
  await act(async () => { transition(B); renderer!.update(tree()); delayed.resolve(responseEvent); });
  expect(router.push).not.toHaveBeenCalled(); expect(Notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
});
test("a delayed verification cannot navigate after switching accounts", async () => {
  await mount(); const delayed = deferred<unknown>(); (verifySupabasePushEvent as jest.Mock).mockReturnValueOnce(delayed.promise);
  await act(async () => { response(responseEvent); });
  await act(async () => { transition(B); renderer!.update(tree()); delayed.resolve(row(A)); });
  expect(router.push).not.toHaveBeenCalled();
});
test("foreign/unknown pushes do not bump counts, refresh or navigate", async () => {
  await mount(); const calls = (listMyNotifications as jest.Mock).mock.calls.length;
  (verifySupabasePushEvent as jest.Mock).mockResolvedValue(row(B));
  await act(async () => { received(receivedEvent); response(responseEvent); });
  expect((listMyNotifications as jest.Mock).mock.calls.length).toBe(calls); expect(value.unreadCount).toBe(1); expect(router.push).not.toHaveBeenCalled();
});
test("verified receipts refresh exact unread counts instead of blindly incrementing", async () => {
  await mount(); await act(async () => { received(receivedEvent); });
  expect(listMyNotifications).toHaveBeenCalledTimes(2); expect(value.unreadCount).toBe(1);
});
test("a newer refresh supersedes an older inbox response within the same account", async () => {
  await mount(); const delayed = deferred<unknown>(); (listMyNotifications as jest.Mock).mockReturnValueOnce(delayed.promise);
  let older!: Promise<void>; await act(async () => { older = value.refresh(); });
  (listMyNotifications as jest.Mock).mockResolvedValueOnce({ items: [{ ...row(A), title: "newest" }], hasMore: false, nextCursor: null });
  await act(async () => { await value.refresh(); delayed.resolve({ items: [{ ...row(A), title: "old" }], hasMore: false, nextCursor: null }); await older; });
  expect(value.notifications[0].title).toBe("newest"); expect(value.isLoading).toBe(false);
});
test("strict-effect replay retains one listener pair and removes it on unmount", async () => {
  await mount(true);
  expect((Notifications.addNotificationReceivedListener as jest.Mock).mock.calls.length - removeReceived.mock.calls.length).toBe(1);
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  expect((Notifications.addNotificationReceivedListener as jest.Mock).mock.calls.length).toBe(removeReceived.mock.calls.length);
  expect((Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls.length).toBe(removeResponse.mock.calls.length);
});
test("Supabase foreground banners require verification; Appwrite behavior stays unchanged", async () => {
  (verifySupabasePushEvent as jest.Mock).mockResolvedValueOnce(null);
  expect(await handler.handleNotification(receivedEvent)).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false, shouldSetBadge: false });
  mode = "appwrite"; await mount(); (verifySupabasePushEvent as jest.Mock).mockClear();
  expect(await handler.handleNotification(receivedEvent)).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true, shouldSetBadge: true });
  expect(verifySupabasePushEvent).not.toHaveBeenCalled();
});
test("foreground display rechecks the session after awaiting verification", async () => {
  (verifySupabasePushEvent as jest.Mock).mockImplementationOnce(async () => { transition(B); return row(A); });
  expect(await handler.handleNotification(receivedEvent)).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
});
