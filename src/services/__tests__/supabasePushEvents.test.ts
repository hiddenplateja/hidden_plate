import { getRuntimeSupabaseServices } from "@/services/backendRuntime";
import { recordSupabaseSession } from "@/services/supabaseSessionFence";
import { verifiedNotificationDestination, verifySupabasePushEvent } from "@/services/supabasePushEvents";
import type { AppNotification } from "@/types/notification";
jest.mock("@/services/backendRuntime", () => ({ getRuntimeSupabaseServices: jest.fn() }));
const A = "fa000000-0000-4000-8000-000000000001", B = "fa000000-0000-4000-8000-000000000002";
const row: AppNotification = { id: A, userId: A, actorId: B, type: "comment", title: "Fixture", body: "Fixture", isRead: false, createdAt: "fixture", data: { reviewId: B } };
const resolve = jest.fn(), load = jest.fn();
function transition(userId: string | null) { recordSupabaseSession(userId ? { user: { id: userId }, access_token: `fixture-${userId}` } : null); }
beforeEach(() => {
  jest.resetAllMocks(); transition(null); transition(A);
  (getRuntimeSupabaseServices as jest.Mock).mockResolvedValue({ gateway: { load } });
  load.mockResolvedValue({ resolveSupabasePushNotification: resolve }); resolve.mockResolvedValue(row);
});
afterEach(() => { jest.useRealTimers(); });
test("verification looks up only a notification ID for the captured caller", async () => {
  expect(await verifySupabasePushEvent({ notificationId: A, postId: "untrusted" })).toBe(row);
  expect(load).toHaveBeenCalledWith("notifications"); expect(resolve).toHaveBeenCalledWith(A, A);
});
test.each([undefined, null, "text", {}, { notificationId: "../private" }, { notificationId: 123 }])("malformed event %p never loads the gateway", async data => {
  expect(await verifySupabasePushEvent(data)).toBeNull(); expect(getRuntimeSupabaseServices).not.toHaveBeenCalled();
});
test("signed-out events never load the gateway", async () => {
  transition(null); expect(await verifySupabasePushEvent({ notificationId: A })).toBeNull(); expect(load).not.toHaveBeenCalled();
});
test("a switch during lazy loading prevents the inbox query", async () => {
  load.mockImplementationOnce(async () => { transition(B); return { resolveSupabasePushNotification: resolve }; });
  expect(await verifySupabasePushEvent({ notificationId: A })).toBeNull(); expect(resolve).not.toHaveBeenCalled();
});
test("a late or wrongly addressed inbox response cannot be accepted", async () => {
  resolve.mockImplementationOnce(async () => { transition(B); return row; });
  expect(await verifySupabasePushEvent({ notificationId: A })).toBeNull();
  transition(A); resolve.mockResolvedValueOnce({ ...row, userId: B });
  expect(await verifySupabasePushEvent({ notificationId: A })).toBeNull();
});
test("verification returns within 1.8 seconds and cannot start queries after its deadline", async () => {
  jest.useFakeTimers(); let finish!: (value: unknown) => void;
  load.mockReturnValueOnce(new Promise(done => { finish = done; }));
  const pending = verifySupabasePushEvent({ notificationId: A });
  await jest.advanceTimersByTimeAsync(1800);
  expect(await pending).toBeNull(); expect(jest.getTimerCount()).toBe(0);
  finish({ resolveSupabasePushNotification: resolve }); await Promise.resolve(); await Promise.resolve();
  expect(resolve).not.toHaveBeenCalled();
});
test("successful and failed verification both release the deadline timer", async () => {
  jest.useFakeTimers(); await verifySupabasePushEvent({ notificationId: A }); expect(jest.getTimerCount()).toBe(0);
  resolve.mockRejectedValueOnce(new Error("offline")); expect(await verifySupabasePushEvent({ notificationId: A })).toBeNull(); expect(jest.getTimerCount()).toBe(0);
});
test("verified routing allows only known destinations and UUID targets", () => {
  expect(verifiedNotificationDestination(row)).toBe(`/review/${B}`);
  expect(verifiedNotificationDestination({ ...row, data: { postId: B } })).toBe(`/post/${B}`);
  expect(verifiedNotificationDestination({ ...row, type: "new_restaurant", data: { restaurantId: B } })).toBe(`/restaurant/${B}`);
  expect(verifiedNotificationDestination({ ...row, data: { postId: "../admin" } })).toBe("/notifications");
  expect(verifiedNotificationDestination({ ...row, type: "follow" })).toBe("/notifications");
});
