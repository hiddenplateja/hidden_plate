import { createStagedSupabaseCheckout, type CheckoutDependencies } from "@/services/supabaseCheckout";
import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import "@/services/supabaseCheckoutRuntime";
import Purchases from "react-native-purchases";
jest.mock("react-native", () => ({ Platform: { OS: "android" } }), { virtual: true });
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock("@/services/supabaseCheckout", () => ({ createStagedSupabaseCheckout: jest.fn(() => ({})) }));
jest.mock("@/services/supabasePurchaseIntents", () => ({ getMySupabasePurchaseIntent: jest.fn(), prepareSupabasePurchaseIntent: jest.fn() }));
jest.mock("@/services/supabase", () => ({ supabase: { auth: { getUser: jest.fn(), getSession: jest.fn() } }, createIsolatedSupabaseAuthClient: jest.fn() }));
jest.mock("react-native-purchases", () => ({ __esModule: true, default: { configure: jest.fn(), logIn: jest.fn(), getAppUserID: jest.fn(), getOfferings: jest.fn(), purchasePackage: jest.fn(), logOut: jest.fn(), setAttributes: jest.fn() } }));
const deps = (createStagedSupabaseCheckout as jest.Mock).mock.calls[0][0] as CheckoutDependencies;
const buyer = "fc260000-0000-4000-8000-000000000001";
const other = "fc260000-0000-4000-8000-000000000002";
const intent = "fc261000-0000-4000-8000-000000000001";
const getUser = supabase.auth.getUser as jest.Mock;
const getSession = supabase.auth.getSession as jest.Mock;
const proof = jest.fn(), invoke = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); delete process.env.EXPO_PUBLIC_SUPABASE_PAYMENTS_ENABLED;
  getUser.mockResolvedValue({ data: { user: { id: buyer } } }); getSession.mockResolvedValue({ data: { session: { user: { id: buyer }, access_token: "fixture-token" } } });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser: proof }, functions: { invoke } });
  proof.mockResolvedValue({ data: { user: { id: buyer } } }); invoke.mockResolvedValue({ data: { code: "fulfilled", fulfilled: true, grantedUntil: "2026-11-01T12:00:00Z" } });
  (Purchases.getAppUserID as jest.Mock).mockResolvedValue(buyer);
});
test("runtime gate is disabled by default and loading it does not configure or charge", () => {
  expect(deps.enabled()).toBe(false); expect(Purchases.configure).not.toHaveBeenCalled(); expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  process.env.EXPO_PUBLIC_SUPABASE_PAYMENTS_ENABLED = "true";
  expect(deps.enabled()).toBe(false); // Environment cannot override free launch.
});
test("submission uses a network-verified pinned caller token with two body identifiers only", async () => {
  expect(await deps.submit(intent, "GPA.fixture", buyer)).toEqual({ fulfilled: true, grantedUntil: "2026-11-01T12:00:00Z" });
  expect(proof).toHaveBeenCalledWith("fixture-token");
  expect(invoke).toHaveBeenCalledWith("verify-purchase", { body: { intentId: intent, storeTransactionId: "GPA.fixture" }, headers: { Authorization: "Bearer fixture-token" }, timeout: 30000 });
});
test("session/proof mismatch and account switch prevent submitting another buyer receipt", async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: other } } } }); await expect(deps.submit(intent, "tx", buyer)).rejects.toThrow("Session changed");
  getSession.mockResolvedValue({ data: { session: { user: { id: buyer }, access_token: "fixture-token" } } });
  proof.mockResolvedValue({ data: { user: { id: other } } }); await expect(deps.submit(intent, "tx", buyer)).rejects.toThrow("Session changed");
  proof.mockResolvedValue({ data: { user: { id: buyer } } }); getUser.mockResolvedValue({ data: { user: { id: other } } });
  await expect(deps.submit(intent, "tx", buyer)).rejects.toThrow("Session changed"); expect(invoke).not.toHaveBeenCalled();
});
test.each([{ data: { code: "verification_pending" } }, { error: { message: "private upstream error" } }, { data: { code: "fulfilled", fulfilled: true, grantedUntil: "bad" } }])("unconfirmed function result never reports fulfillment", async result => {
  invoke.mockResolvedValue(result); expect(await deps.submit(intent, "tx", buyer)).toEqual({ fulfilled: false });
});
test("native identity uses explicit UUID configure/login, never anonymous logout or restaurant attributes", async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "fixture-public-key";
  await deps.native.identify(buyer); expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: "fixture-public-key", appUserID: buyer });
  await deps.native.identify(buyer); await deps.native.identify(other);
  expect(Purchases.logIn).toHaveBeenCalledWith(other); expect(Purchases.configure).toHaveBeenCalledTimes(1);
  expect((Purchases as unknown as { logOut: jest.Mock }).logOut).not.toHaveBeenCalled(); expect(Purchases.setAttributes).not.toHaveBeenCalled();
});
test("native offering fetch rechecks buyer/SDK identity immediately before store call", async () => {
  const pkg = { product: { identifier: "feature_7d" } }; (Purchases.getOfferings as jest.Mock).mockResolvedValue({ current: { availablePackages: [pkg] } });
  getUser.mockResolvedValue({ data: { user: { id: other } } }); await expect(deps.native.buy("feature_7d", buyer)).rejects.toThrow("Session changed"); expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  getUser.mockResolvedValue({ data: { user: { id: buyer } } });
  (Purchases.purchasePackage as jest.Mock).mockResolvedValue({ productIdentifier: "feature_7d", transaction: { transactionIdentifier: "GPA.fixture" } });
  expect(await deps.native.buy("feature_7d", buyer)).toEqual({ product: "feature_7d", transaction: "GPA.fixture" });
});
