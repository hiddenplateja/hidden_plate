import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
const names = { auth:"auth", admin:"admin", users:"users", restaurants:"restaurants", reviews:"reviews", storage:"storage", saved:"saved", badges:"badges", follows:"follows", blocks:"blocks", lists:"collections", posts:"posts", reviewLikes:"reviewLikes", reviewComments:"reviewComments", postLikes:"postLikes", postComments:"postComments", notifications:"notifications", pushTokens:"pushTokens", userPreferences:"preferences", reports:"reports", bugReports:"bugReports", claims:"claims", restaurantMenus:"ownerMenus", reviewResponses:"ownerReplies", restaurantViews:"restaurantViews", spotOfTheDay:"spotlight", remoteConfig:"remoteConfig", accountDeletion:"accountDeletion" };
let mode: "appwrite" | "supabase", legacyLoad: jest.Mock, portLoad: jest.Mock, operation: jest.Mock;
let original: NodeJS.ProcessEnv;
beforeEach(() => {
  jest.resetModules(); original = { ...process.env }; process.env.EXPO_PUBLIC_BACKEND_BUILD = "preview";
  mode = "appwrite"; legacyLoad = jest.fn(); portLoad = jest.fn(); operation = jest.fn().mockResolvedValue("result");
  jest.doMock("@/services/backendTestConfiguration", () => ({ resolveAppBackend: () => mode,
    readBackendTestEnvironment: () => ({}), validateSupabaseTestConfiguration: () => ({ cacheNamespace: "supabase:test" }) }));
  jest.doMock("@/services/supabaseTestScreenServices", () => ({ createSupabaseTestScreenServices: () => ({ load: portLoad }) }));
  jest.doMock("@/services/appwrite", () => { throw new Error("No Appwrite initialization while importing facades"); });
  jest.doMock("react-native-appwrite", () => { throw new Error("No eager native Appwrite SDK"); });
  jest.doMock("expo-constants", () => ({ __esModule: true, default: {} }));
  jest.doMock("expo-image-manipulator", () => ({ SaveFormat: { JPEG: "jpeg" }, manipulateAsync: jest.fn() }));
  for (const name of Object.keys(names)) jest.doMock(`@/services/legacy/${name}`, () => {
    legacyLoad(name); return { getReviewById: operation, updateMyProfile: operation, markRead: operation };
  });
  portLoad.mockImplementation(async () => ({ getReviewById: operation, updateMyProfile: operation, markRead: operation }));
});
afterEach(() => { process.env = original; });

function fence() {
  return jest.requireActual("@/services/supabaseSessionFence") as typeof import("@/services/supabaseSessionFence");
}
const sessionA = { user: { id: "fixture-a" }, access_token: "fixture-token-a" };
const sessionB = { user: { id: "fixture-b" }, access_token: "fixture-token-b" };
test("a transition during lazy port loading prevents an old-account mutation from starting", async () => {
  mode = "supabase"; fence().recordSupabaseSession(sessionA);
  let resolve!: (port: unknown) => void;
  portLoad.mockReturnValue(new Promise(done => { resolve = done; }));
  const users = jest.requireActual("@/services/users") as typeof import("@/services/users");
  const pending = expect(users.updateMyProfile({ bio: "old-account" })).rejects.toThrow("session changed");
  for (let step = 0; step < 10 && !portLoad.mock.calls.length; step++) await Promise.resolve();
  expect(portLoad).toHaveBeenCalledTimes(1);
  fence().recordSupabaseSession(sessionB); resolve({ updateMyProfile: operation });
  await pending;
  expect(operation).not.toHaveBeenCalled(); expect(legacyLoad).not.toHaveBeenCalled();
});
test("a transition during an operation discards its late response", async () => {
  mode = "supabase"; fence().recordSupabaseSession(sessionA);
  operation.mockImplementation(async () => { fence().recordSupabaseSession(sessionB); return { private: "account-a" }; });
  const notifications = jest.requireActual("@/services/notifications") as typeof import("@/services/notifications");
  await expect(notifications.markRead("id")).rejects.toThrow("session changed");
  expect(operation).toHaveBeenCalledTimes(1);
});
test("sign-out and sign-in as the same account still invalidate an earlier call", async () => {
  mode = "supabase"; fence().recordSupabaseSession(sessionA);
  operation.mockImplementation(async () => {
    fence().recordSupabaseSession(null); fence().recordSupabaseSession(sessionA); return "stale";
  });
  const reviews = jest.requireActual("@/services/reviews") as typeof import("@/services/reviews");
  await expect(reviews.getReviewById("id")).rejects.toThrow("session changed");
});
test("token rotation invalidates an old call, but a repeated unchanged auth event does not", async () => {
  mode = "supabase"; fence().recordSupabaseSession(sessionA);
  const reviews = jest.requireActual("@/services/reviews") as typeof import("@/services/reviews");
  operation.mockImplementationOnce(async () => { fence().recordSupabaseSession(sessionA); return "same"; });
  expect(await reviews.getReviewById("id")).toBe("same");
  operation.mockImplementationOnce(async () => { fence().recordSupabaseSession({ ...sessionA, access_token: "fixture-rotated" }); return "stale"; });
  await expect(reviews.getReviewById("id")).rejects.toThrow("session changed");
});
test("auth actions can intentionally establish a session and deletion can sign out after invocation", async () => {
  mode = "supabase";
  const runtime = jest.requireActual("@/services/backendRuntime") as typeof import("@/services/backendRuntime");
  portLoad.mockResolvedValue({ login: operation, deleteMyAccount: operation });
  operation.mockImplementationOnce(async () => { fence().recordSupabaseSession(sessionA); return "authenticated"; });
  expect(await runtime.dispatchBackendService<() => Promise<string>>("auth", "login", [], async () => ({}))).toBe("authenticated");
  operation.mockImplementationOnce(async () => { fence().recordSupabaseSession(null); return "deleted"; });
  expect(await runtime.dispatchBackendService<() => Promise<string>>("accountDeletion", "deleteMyAccount", [], async () => ({}))).toBe("deleted");
});
test("account deletion also rejects a transition while its port loads", async () => {
  mode = "supabase"; fence().recordSupabaseSession(sessionA);
  const runtime = jest.requireActual("@/services/backendRuntime") as typeof import("@/services/backendRuntime");
  portLoad.mockImplementation(async () => { fence().recordSupabaseSession(sessionB); return { deleteMyAccount: operation }; });
  await expect(runtime.dispatchBackendService<() => Promise<string>>("accountDeletion", "deleteMyAccount", [], async () => ({}))).rejects.toThrow("session changed");
  expect(operation).not.toHaveBeenCalled();
});
test("all 28 existing import paths are safe to load without initializing either backend", () => {
  for (const name of Object.keys(names)) jest.requireActual(`@/services/${name}`);
  expect(legacyLoad).not.toHaveBeenCalled(); expect(portLoad).not.toHaveBeenCalled();
});
test("Appwrite remains the selected implementation and preserves arguments/result identity", async () => {
  const review = jest.requireActual("@/services/reviews") as typeof import("@/services/reviews");
  const result = { id: "review" }; operation.mockResolvedValue(result);
  expect(await review.getReviewById("review-id")).toBe(result);
  expect(operation).toHaveBeenCalledWith("review-id"); expect(legacyLoad).toHaveBeenCalledWith("reviews"); expect(portLoad).not.toHaveBeenCalled();
});
test("Supabase routing never falls back to Appwrite and preserves the public error identity/code", async () => {
  mode = "supabase"; const users = jest.requireActual("@/services/users") as typeof import("@/services/users");
  operation.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission_denied" }));
  await expect(users.updateMyProfile({ bio: "test" })).rejects.toBeInstanceOf(users.UserError);
  await expect(users.updateMyProfile({ bio: "test" })).rejects.toMatchObject({ message: "denied", code: "permission_denied" });
  expect(portLoad).toHaveBeenCalledWith("users"); expect(legacyLoad).not.toHaveBeenCalled();
});
test("backend selection is immutable for this app instance", async () => {
  const runtime = jest.requireActual("@/services/backendRuntime") as typeof import("@/services/backendRuntime");
  expect(runtime.getRuntimeBackend()).toBe("appwrite"); mode = "supabase";
  expect(runtime.getRuntimeBackend()).toBe("appwrite");
});
test("legacy notification/permission/payment-only helpers reject on Supabase without querying Appwrite", async () => {
  mode = "supabase";
  const notifications = jest.requireActual("@/services/notifications") as typeof import("@/services/notifications");
  await expect(notifications.hasRecentSimilarNotification({ recipientUserId:"other", actorId:"actor", type:"follow" })).rejects.toThrow("legacy-only");
  const restaurants = jest.requireActual("@/services/restaurants") as typeof import("@/services/restaurants");
  await expect(restaurants.setRestaurantListingPaidUntil("restaurant", null)).rejects.toThrow("legacy-only");
  expect(legacyLoad).not.toHaveBeenCalled(); expect(portLoad).not.toHaveBeenCalled();
});
test.each(Object.keys(names))("%s facade retains every async legacy public function", name => {
  const file = path.resolve(__dirname, `../legacy/${name}.ts`), text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const facade = jest.requireActual(`@/services/${name}`) as Record<string, unknown>;
  for (const node of source.statements) if (ts.isFunctionDeclaration(node) && node.name
    && node.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)
    && node.modifiers?.some(item => item.kind === ts.SyntaxKind.AsyncKeyword)) expect(typeof facade[node.name.text]).toBe("function");
});
