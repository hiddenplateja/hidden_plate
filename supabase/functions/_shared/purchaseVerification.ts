// Pure validation only. Inputs must come from RevenueCat's server API, never
// directly from an HTTP body. No network calls or payment grants happen here.
export type PurchaseExpectation = {
  projectId: string; buyerId: string; productId: string; storeTransactionId: string;
  environment: "SANDBOX" | "PRODUCTION";
  allowedApps: Record<string, "APP_STORE" | "PLAY_STORE">;
  createdAt: string; expiresAt: string;
};
export type VerifiedPurchaseProof = {
  rc_project_id: string; rc_purchase_id: string; buyer_id: string; app_id: string;
  store: "APP_STORE" | "PLAY_STORE"; environment: "SANDBOX" | "PRODUCTION";
  store_transaction_id: string; product_id: string; purchased_at: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid purchase verification response.");
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Unsafe transaction identifier.");
    value = String(value);
  }
  if (typeof value !== "string" || !value || value.length > 255 || value.trim() !== value) throw new Error("Invalid purchase identifier.");
  return value;
}
/** Fail closed on aliases, transfers, ambiguous results or unverified products. */
export function verifyRevenueCatPurchase(search: unknown, productResponse: unknown, expected: PurchaseExpectation, now = Date.now()): VerifiedPurchaseProof {
  const response = object(search);
  if (response.object !== "list" || !Array.isArray(response.items) || response.items.length !== 1 || response.next_page) throw new Error("Purchase verification is missing or ambiguous.");
  const purchase = object(response.items[0]); const product = object(productResponse);
  const projectId = identifier(expected.projectId); const buyerId = identifier(expected.buyerId);
  const transactionId = identifier(purchase.store_purchase_identifier);
  if (purchase.object !== "purchase" || purchase.customer_id !== buyerId || purchase.original_customer_id !== buyerId
    || purchase.status !== "owned" || purchase.ownership !== "purchased" || purchase.quantity !== 1
    || transactionId !== identifier(expected.storeTransactionId)) throw new Error("Purchase is not owned by this verified account.");
  const environment = purchase.environment === "sandbox" ? "SANDBOX" : purchase.environment === "production" ? "PRODUCTION" : null;
  const store = purchase.store === "app_store" ? "APP_STORE" : purchase.store === "play_store" ? "PLAY_STORE" : null;
  const appId = identifier(product.app_id);
  if (!store || environment !== expected.environment || !Object.hasOwn(expected.allowedApps, appId)
    || expected.allowedApps[appId] !== store) throw new Error("Purchase app, store or environment is not allowed.");
  const type = product.type;
  const consumable = type === "consumable" || (type === "one_time" && object(product.one_time).is_consumable === true);
  if (product.object !== "product" || product.state !== "active" || !consumable || identifier(product.id) !== identifier(purchase.product_id)
    || product.store_identifier !== expected.productId) throw new Error("Purchase product does not match the intent.");
  const purchased = purchase.purchased_at; const created = Date.parse(expected.createdAt); const expires = Date.parse(expected.expiresAt);
  if (typeof purchased !== "number" || !Number.isSafeInteger(purchased) || purchased < 0
    || !Number.isFinite(created) || !Number.isFinite(expires) || expires < created
    || purchased < created - 300000 || purchased > expires || purchased > now + 300000) throw new Error("Purchase time does not match the intent.");
  return {
    rc_project_id: projectId, rc_purchase_id: identifier(purchase.id), buyer_id: buyerId, app_id: appId,
    store, environment: expected.environment, store_transaction_id: transactionId,
    product_id: expected.productId, purchased_at: new Date(purchased).toISOString(),
  };
}
