// Staged coordinator; no screens/provider import this file. Retries never buy.
import type { SupabasePurchaseIntent } from "@/services/supabasePurchaseIntents";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const product = /^[A-Za-z0-9._-]{1,200}$/;
const transaction = /^[\x21-\x7e]{1,255}$/;
type Journal = { version: 1; buyer: string; intent: string; restaurant: string; product: string; stage: "purchasing" | "receipt"; transaction?: string };
export type StagedCheckoutResult = { status: "fulfilled"; grantedUntil: string } |
  { status: "pending" | "recovery_required" | "cancelled" | "disabled" | "session_changed" | "busy" };
export type CheckoutDependencies = {
  enabled(): boolean;
  user(): Promise<string | null>;
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
  prepare(intent: string, restaurant: string, product: string): Promise<SupabasePurchaseIntent>;
  status(intent: string): Promise<SupabasePurchaseIntent | null>;
  submit(intent: string, transaction: string, buyer: string): Promise<{ fulfilled: boolean; grantedUntil?: string }>;
  native: { identify(buyer: string): Promise<void>; identity(): Promise<string>; buy(product: string, buyer: string): Promise<{ product: string; transaction: string }> };
};
const key = (buyer: string) => `hidden-plate:supabase-purchase:v1:${buyer}`;
function decode(raw: string, buyer: string): Journal {
  const value = JSON.parse(raw) as Journal;
  if (!value || value.version !== 1 || value.buyer !== buyer || typeof value.intent !== "string" || !uuid.test(value.intent)
    || typeof value.restaurant !== "string" || !uuid.test(value.restaurant) || typeof value.product !== "string"
    || !product.test(value.product) || !["purchasing", "receipt"].includes(value.stage)
    || (value.stage === "receipt" && (typeof value.transaction !== "string" || !transaction.test(value.transaction)))) throw new Error("Purchase recovery record needs support.");
  return value;
}
export function createStagedSupabaseCheckout(deps: CheckoutDependencies) {
  let busy = false;
  // A storage failure AFTER payment preserves the receipt in memory. On restart
  // the pre-charge journal still blocks rebuying; store recovery is then needed.
  const unsaved = new Map<string, Journal>();
  async function load(buyer: string): Promise<Journal | null> {
    if (unsaved.has(buyer)) return unsaved.get(buyer)!;
    const raw = await deps.storage.getItem(key(buyer)); return raw === null ? null : decode(raw, buyer);
  }
  async function same(buyer: string) { return await deps.user() === buyer; }
  async function finish(buyer: string, journal: Journal): Promise<StagedCheckoutResult> {
    if (!await same(buyer)) return { status: "session_changed" };
    try {
      const status = await deps.status(journal.intent);
      if (status?.fulfilled && status.grantedUntil && Number.isFinite(Date.parse(status.grantedUntil))) {
        await deps.storage.removeItem(key(buyer)); unsaved.delete(buyer);
        return { status: "fulfilled", grantedUntil: status.grantedUntil };
      }
      if (journal.stage === "purchasing") return { status: "recovery_required" };
      // Receipt must be durable before submission. On failure keep it in memory
      // and retain the pre-charge marker on disk; do not buy again.
      await deps.storage.setItem(key(buyer), JSON.stringify(journal)); unsaved.delete(buyer);
      if (!await same(buyer)) return { status: "session_changed" };
      const result = await deps.submit(journal.intent, journal.transaction!, buyer);
      if (!result.fulfilled || !result.grantedUntil || !Number.isFinite(Date.parse(result.grantedUntil))) return { status: "pending" };
      await deps.storage.removeItem(key(buyer));
      return { status: "fulfilled", grantedUntil: result.grantedUntil };
    } catch { return { status: "pending" }; }
  }
  async function locked(work: (buyer: string) => Promise<StagedCheckoutResult>): Promise<StagedCheckoutResult> {
    if (!deps.enabled()) return { status: "disabled" };
    if (busy) return { status: "busy" }; busy = true;
    try {
      const buyer = await deps.user(); if (!buyer || !uuid.test(buyer)) return { status: "session_changed" };
      return await work(buyer);
    } finally { busy = false; }
  }
  return {
    purchase(intent: string, restaurant: string, storeProduct: string): Promise<StagedCheckoutResult> {
      if (!uuid.test(intent) || !uuid.test(restaurant) || !product.test(storeProduct)) return Promise.reject(new Error("Invalid purchase request."));
      return locked(async buyer => {
        const previous = await load(buyer); if (previous) return finish(buyer, previous);
        const prepared = await deps.prepare(intent, restaurant, storeProduct);
        if (prepared.id !== intent || prepared.productId !== storeProduct) throw new Error("Purchase intent mismatch.");
        if (prepared.fulfilled) {
          const status = await deps.status(intent);
          return status?.fulfilled && status.grantedUntil ? { status: "fulfilled", grantedUntil: status.grantedUntil } : { status: "pending" };
        }
        if (!Number.isFinite(Date.parse(prepared.expiresAt)) || Date.parse(prepared.expiresAt) <= Date.now()) throw new Error("Purchase intent has expired.");
        if (!await same(buyer)) return { status: "session_changed" };
        await deps.native.identify(buyer);
        if (!await same(buyer) || await deps.native.identity() !== buyer) return { status: "session_changed" };
        const journal: Journal = { version: 1, buyer, intent, restaurant, product: storeProduct, stage: "purchasing" };
        // Failure to persist here aborts before any store purchase.
        await deps.storage.setItem(key(buyer), JSON.stringify(journal));
        if (!await same(buyer)) { await deps.storage.removeItem(key(buyer)); return { status: "session_changed" }; }
        let receipt: { product: string; transaction: string };
        try { receipt = await deps.native.buy(storeProduct, buyer); }
        catch (error) {
          if (typeof error === "object" && error !== null && "userCancelled" in error && error.userCancelled === true) {
            await deps.storage.removeItem(key(buyer)); return { status: "cancelled" };
          }
          return { status: "recovery_required" };
        }
        if (receipt.product !== storeProduct || typeof receipt.transaction !== "string" || !transaction.test(receipt.transaction)) return { status: "recovery_required" };
        journal.stage = "receipt"; journal.transaction = receipt.transaction; unsaved.set(buyer, journal);
        // Save the original buyer's receipt even when auth changed during the
        // store sheet. A new account must not submit it, but it must survive restart.
        try { await deps.storage.setItem(key(buyer), JSON.stringify(journal)); unsaved.delete(buyer); }
        catch { return { status: "pending" }; }
        return finish(buyer, journal);
      });
    },
    retry(): Promise<StagedCheckoutResult> {
      return locked(async buyer => { const journal = await load(buyer); return journal ? finish(buyer, journal) : { status: "pending" }; });
    },
    // Explicit recovery only: obtain the exact store transaction from the store/
    // RevenueCat history. The server independently verifies it; never rebuy.
    recover(storeProduct: string, storeTransaction: string): Promise<StagedCheckoutResult> {
      if (!product.test(storeProduct) || !transaction.test(storeTransaction)) return Promise.reject(new Error("Invalid purchase recovery."));
      return locked(async buyer => {
        const journal = await load(buyer);
        if (!journal || journal.product !== storeProduct) throw new Error("No matching purchase recovery record.");
        if (journal.stage === "receipt" && journal.transaction !== storeTransaction) throw new Error("Cannot replace a saved transaction.");
        journal.stage = "receipt"; journal.transaction = storeTransaction; unsaved.set(buyer, journal);
        return finish(buyer, journal);
      });
    },
  };
}
