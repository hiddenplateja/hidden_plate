import { supabase } from "@/services/supabase";
import { prepareSupabasePurchaseIntent, getMySupabasePurchaseIntent } from "@/services/supabasePurchaseIntents";
jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const id = "fc251000-0000-4000-8000-000000000001";
const restaurant = "fc254000-0000-4000-8000-000000000001";
const row = { id, product_id: "feature_7d", kind: "feature", days: 7, expires_at: "2026-10-12T14:00:00Z", fulfilled: false };
beforeEach(() => { jest.resetAllMocks(); (supabase.rpc as jest.Mock).mockResolvedValue({ data: row, error: null }); });
test("intent preparation sends only request/restaurant/product, never authority fields", async () => {
  expect(await prepareSupabasePurchaseIntent(id, restaurant, "feature_7d")).toMatchObject({ id, productId: "feature_7d", kind: "feature", days: 7, grantedUntil: null });
  expect(supabase.rpc).toHaveBeenCalledWith("prepare_purchase_intent", { request_id: id, target_restaurant: restaurant, store_product: "feature_7d" });
  expect(supabase.from).not.toHaveBeenCalled();
});
test("disabled payments and active-account/ownership errors propagate", async () => {
  for (const message of ["Payments are not enabled.", "Buyer needs an active account.", "Active restaurant ownership required."]) {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: { message } }); await expect(prepareSupabasePurchaseIntent(id, restaurant, "feature_7d")).rejects.toThrow(message);
  }
});
test("invalid request IDs, restaurant IDs and product names stop locally", async () => {
  await expect(prepareSupabasePurchaseIntent("bad", restaurant, "feature_7d")).rejects.toThrow("Invalid purchase intent");
  await expect(prepareSupabasePurchaseIntent(id, "bad", "feature_7d")).rejects.toThrow("Invalid purchase intent");
  await expect(prepareSupabasePurchaseIntent(id, restaurant, "bad product")).rejects.toThrow("Invalid purchase intent");
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test("status reads preserve fulfillment and report unavailable intents as null", async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: { ...row, fulfilled: true, granted_until: "2026-10-19T12:00:00Z" } });
  expect(await getMySupabasePurchaseIntent(id)).toMatchObject({ fulfilled: true, grantedUntil: "2026-10-19T12:00:00Z" });
  expect(supabase.rpc).toHaveBeenCalledWith("my_purchase_intent", { target_intent: id });
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null }); expect(await getMySupabasePurchaseIntent(id)).toBeNull();
});
test.each([{ ...row, days: 1.5 }, { ...row, expires_at: "bad" }, { ...row, kind: "admin" }, { ...row, fulfilled: "true" }, null])("malformed intent response is rejected", async data => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data }); await expect(prepareSupabasePurchaseIntent(id, restaurant, "feature_7d")).rejects.toThrow();
});
test("responses for a different intent/product cannot cross requests", async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: { ...row, product_id: "listing_1yr" } }); await expect(prepareSupabasePurchaseIntent(id, restaurant, "feature_7d")).rejects.toThrow("did not match");
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: { ...row, id: restaurant } }); await expect(getMySupabasePurchaseIntent(id)).rejects.toThrow("did not match");
});
