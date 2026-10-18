import { verifyRevenueCatPurchase, type PurchaseExpectation } from "./purchaseVerification.ts";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
const now = Date.parse("2026-10-12T12:00:00Z");
const expectation: PurchaseExpectation = {
  projectId: "proj-fixture", buyerId: "fc250000-0000-4000-8000-000000000001", productId: "feature_7d",
  storeTransactionId: "GPA.fixture", environment: "SANDBOX", allowedApps: { "app-fixture": "PLAY_STORE" },
  createdAt: "2026-10-12T11:30:00Z", expiresAt: "2026-10-12T13:30:00Z",
};
function fixtures() {
  const purchase = { object: "purchase", id: "purch-fixture", customer_id: expectation.buyerId, original_customer_id: expectation.buyerId,
    product_id: "prod-fixture", purchased_at: now, quantity: 1, status: "owned", ownership: "purchased", environment: "sandbox", store: "play_store", store_purchase_identifier: "GPA.fixture" };
  const product = { object: "product", state: "active", id: "prod-fixture", store_identifier: "feature_7d", type: "consumable", app_id: "app-fixture" };
  return { purchase, product, search: { object: "list", items: [purchase] } };
}
function denied(fn: () => unknown) { let error = false; try { fn(); } catch { error = true; } assert(error, "Unsafe purchase accepted"); }
Deno.test("verified Android purchase yields minimal proof, not raw personal fields", () => {
  const f = fixtures(); const proof = verifyRevenueCatPurchase(f.search, f.product, expectation, now);
  assert(proof.rc_purchase_id === "purch-fixture" && proof.store === "PLAY_STORE" && Object.keys(proof).length === 9, "Wrong proof contract");
});
Deno.test("iOS one-time consumable supports safe numeric transaction IDs", () => {
  const f = fixtures(); Object.assign(f.purchase, { store: "app_store", store_purchase_identifier: 12345678 });
  Object.assign(f.product, { type: "one_time", one_time: { is_consumable: true } });
  const proof = verifyRevenueCatPurchase(f.search, f.product, { ...expectation, storeTransactionId: "12345678", allowedApps: { "app-fixture": "APP_STORE" } }, now);
  assert(proof.store_transaction_id === "12345678", "Identifier changed");
});
for (const [field, value] of Object.entries({ customer_id: "other", original_customer_id: "alias", status: "refunded", ownership: "family_shared", quantity: 2,
  environment: "production", store: "promotional", store_purchase_identifier: "other", product_id: "wrong", purchased_at: now + 3600000 })) {
  Deno.test(`purchase rejects ${field} mismatch`, () => { const f = fixtures(); Object.assign(f.purchase, { [field]: value }); denied(() => verifyRevenueCatPurchase(f.search, f.product, expectation, now)); });
}
for (const [field, value] of Object.entries({ id: "wrong", app_id: "unknown", store_identifier: "listing_1yr", state: "archived", type: "subscription" })) {
  Deno.test(`product rejects ${field} mismatch`, () => { const f = fixtures(); Object.assign(f.product, { [field]: value }); denied(() => verifyRevenueCatPurchase(f.search, f.product, expectation, now)); });
}
Deno.test("missing, duplicated, continued and malformed result lists are rejected", () => {
  const f = fixtures(); for (const search of [null, {}, { ...f.search, items: [] }, { ...f.search, items: [f.purchase, f.purchase] }, { ...f.search, next_page: "/next" }, { ...f.search, items: [null] }]) {
    denied(() => verifyRevenueCatPurchase(search, f.product, expectation, now));
  }
});
Deno.test("unsafe numbers and stale purchases cannot be correlated approximately", () => {
  const f = fixtures(); Object.assign(f.purchase, { store_purchase_identifier: Number.MAX_SAFE_INTEGER + 1 });
  denied(() => verifyRevenueCatPurchase(f.search, f.product, expectation, now));
  Object.assign(f.purchase, { store_purchase_identifier: expectation.storeTransactionId, purchased_at: now - 7200000 });
  denied(() => verifyRevenueCatPurchase(f.search, f.product, expectation, now));
});
Deno.test("delivery after intent expiry is allowed when verified purchase was on time", () => {
  const f = fixtures(); const proof = verifyRevenueCatPurchase(f.search, f.product, expectation, now + 86400000);
  assert(proof.purchased_at === new Date(now).toISOString(), "Delayed delivery lost original time");
});
Deno.test("non-consumable one-time product is denied", () => {
  const f = fixtures(); Object.assign(f.product, { type: "one_time", one_time: { is_consumable: false } });
  denied(() => verifyRevenueCatPurchase(f.search, f.product, expectation, now));
});
