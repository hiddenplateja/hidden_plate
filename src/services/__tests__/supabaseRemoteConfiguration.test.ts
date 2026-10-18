import { supabase } from "@/services/supabase";
import { readSupabaseAppConfiguration } from "@/services/supabaseAppConfiguration";
import { compareSupabaseVersions, fetchSupabaseAppGate, resolveSupabaseAppGate, patchSupabaseAppControl } from "@/services/supabaseRemoteConfig";
import { getSupabasePaymentPlans, getSupabaseFeaturePlans, getSupabaseListingPlans, patchSupabasePaymentPlans } from "@/services/supabasePaymentPlans";
jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock("@/services/supabaseDataRequest", () => ({ requestSupabaseRpc: (...args: unknown[]) => (supabase.rpc as jest.Mock)(...args) }));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.0.0" }));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
const read = jest.fn();
const feature = { id: "14d", label: "14 days", days: 14, amount: 100, currency: "JMD", productId: "feature_14d" };
const listing = { id: "2yr", label: "2 years", days: 730, amount: 9000, currency: "JMD", productId: "listing_2yr" };
beforeEach(() => {
  jest.resetAllMocks();
  read.mockResolvedValue({ data: null, error: null });
  (supabase.rpc as jest.Mock).mockImplementation(() => ({ abortSignal: read }));
});
afterEach(() => jest.useRealTimers());
test.each([
  ["1.0", "1.0.0", 0], ["1.2", "1.10", -1], ["2.0", "1.99", 1], ["1.2-beta", "1.2", 0],
])("version comparison %s and %s", (a, b, expected) => expect(compareSupabaseVersions(a, b)).toBe(expected));
test("maintenance wins over required updates, preserving default text", () => {
  expect(resolveSupabaseAppGate({ maintenance: true, maintenance_message: " ", min_version: "2" }, "1", "android"))
    .toEqual({ status: "maintenance", message: "Hidden Plate is down for a quick tune-up. Please check back soon." });
});
test("required and optional updates use platform-specific store URLs", () => {
  const control = { min_version: "2.0", latest_version: "3.0", update_message: "Please update", android_url: "https://play.google.com/test", ios_url: "https://apps.apple.com/test" };
  expect(resolveSupabaseAppGate(control, "1.0", "android")).toEqual({ status: "update-required", message: "Please update", storeUrl: control.android_url });
  expect(resolveSupabaseAppGate(control, "2.0", "ios")).toEqual({ status: "update-optional", message: "Please update", storeUrl: control.ios_url });
  expect(resolveSupabaseAppGate(control, "3.0", "ios")).toEqual({ status: "ok" });
});
test("blank versions/missing config do not gate; unsafe store links are not launched", () => {
  expect(resolveSupabaseAppGate(null, "1", "android")).toEqual({ status: "ok" });
  expect(resolveSupabaseAppGate({ min_version: " " }, "1", "ios")).toEqual({ status: "ok" });
  expect(resolveSupabaseAppGate({ min_version: "2", android_url: "javascript:bad" }, "1", "android")).toMatchObject({ status: "update-required", storeUrl: "" });
});
test("before-auth reads use the public RPC without Appwrite/session queries", async () => {
  read.mockResolvedValue({ data: { control: { maintenance: true, maintenance_message: "Back soon" } }, error: null });
  expect(await fetchSupabaseAppGate()).toEqual({ status: "maintenance", message: "Back soon" });
  expect(supabase.rpc).toHaveBeenCalledWith("public_app_configuration");
  expect(supabase.auth.getUser).not.toHaveBeenCalled(); expect(supabase.from).not.toHaveBeenCalled();
});
test("offline, RPC-error and malformed control fail open", async () => {
  read.mockRejectedValue(new Error("Offline")); expect(await fetchSupabaseAppGate()).toEqual({ status: "ok" });
  read.mockResolvedValue({ error: { message: "Unavailable" } }); expect(await fetchSupabaseAppGate()).toEqual({ status: "ok" });
  read.mockResolvedValue({ data: { control: [] } }); expect(await fetchSupabaseAppGate()).toEqual({ status: "ok" });
});
test("an unresponsive configuration endpoint aborts after eight seconds and fails open", async () => {
  jest.useFakeTimers(); read.mockReturnValue(new Promise(() => {}));
  const gate = fetchSupabaseAppGate(); const signal = read.mock.calls[0][0] as AbortSignal;
  await jest.advanceTimersByTimeAsync(8000);
  expect(await gate).toEqual({ status: "ok" }); expect(signal.aborted).toBe(true); expect(jest.getTimerCount()).toBe(0);
});
test("successful reads clean up their timeout", async () => {
  jest.useFakeTimers(); await readSupabaseAppConfiguration(); expect(jest.getTimerCount()).toBe(0);
});
test("missing/empty display catalogs preserve existing defaults and independent copies", async () => {
  const first = await getSupabasePaymentPlans(); expect(first.feature.map(p => p.productId)).toEqual(["feature_7d", "feature_30d"]);
  expect(first.listing[0]).toMatchObject({ days: 365, amount: 5000, currency: "JMD" });
  first.feature[0].days = 99; expect((await getSupabaseFeaturePlans())[0].days).toBe(7);
  read.mockResolvedValue({ data: { feature_plans: [], listing_plans: null } }); expect((await getSupabaseListingPlans())[0].productId).toBe("listing_1yr");
});
test("valid display catalogs retain exact payloads without starting a purchase", async () => {
  read.mockResolvedValue({ data: { feature_plans: [feature], listing_plans: [listing] } });
  expect(await getSupabasePaymentPlans()).toEqual({ feature: [feature], listing: [listing] });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});
test.each([
  { ...feature, days: 1.5 }, { ...feature, amount: -1 }, { ...feature, currency: "jmd" },
  { ...feature, productId: "bad product" }, { ...feature, unexpected: "private" },
])("invalid plan rows fall back without exposing arbitrary fields", async invalid => {
  read.mockResolvedValue({ data: { feature_plans: [invalid], listing_plans: [listing] } });
  expect((await getSupabasePaymentPlans()).feature[0].productId).toBe("feature_7d");
});
test("duplicates/missing listing products are rejected independently", async () => {
  read.mockResolvedValue({ data: { feature_plans: [feature, feature], listing_plans: [{ ...listing, productId: undefined }] } });
  expect((await getSupabasePaymentPlans()).listing[0].productId).toBe("listing_1yr");
  expect((await getSupabasePaymentPlans()).feature[0].productId).toBe("feature_7d");
});
test("display catalog failures are tolerant", async () => {
  read.mockRejectedValue(new Error("Offline")); expect((await getSupabasePaymentPlans()).feature).toHaveLength(2);
});
test("admin edits send whitelisted patch contracts to server-checked RPCs", async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: { maintenance: false }, error: null });
  expect(await patchSupabaseAppControl({ maintenance: false })).toEqual({ maintenance: false });
  expect(supabase.rpc).toHaveBeenCalledWith("admin_patch_app_control", { payload: { maintenance: false } });
  await patchSupabasePaymentPlans({ feature_plans: [feature], listing_plans: null });
  expect(supabase.rpc).toHaveBeenLastCalledWith("admin_patch_display_plans", { payload: { feature_plans: [feature], listing_plans: null } });
});
test("invalid catalog edits stop locally; server admin denial propagates", async () => {
  await expect(patchSupabasePaymentPlans({ feature_plans: [{ ...feature, days: 0 }] })).rejects.toThrow("Invalid plan catalog");
  expect(supabase.rpc).not.toHaveBeenCalled();
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: { message: "Admin access required." } });
  await expect(patchSupabaseAppControl({ maintenance: true })).rejects.toThrow("Admin access required");
  await expect(patchSupabasePaymentPlans({ listing_plans: [] })).rejects.toThrow("Admin access required");
});
