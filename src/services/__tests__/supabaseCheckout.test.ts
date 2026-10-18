import { createStagedSupabaseCheckout, type CheckoutDependencies } from "@/services/supabaseCheckout";
const buyer = "fc260000-0000-4000-8000-000000000001";
const other = "fc260000-0000-4000-8000-000000000002";
const intent = "fc261000-0000-4000-8000-000000000001";
const restaurant = "fc264000-0000-4000-8000-000000000001";
const granted = "2026-11-01T12:00:00Z";
function setup() {
  const data = new Map<string, string>(); let active: string | null = buyer;
  const deps: CheckoutDependencies = {
    enabled: jest.fn(() => true), user: jest.fn(async () => active),
    storage: { getItem: jest.fn(async key => data.get(key) ?? null), setItem: jest.fn(async (key, value) => { data.set(key, value); }), removeItem: jest.fn(async key => { data.delete(key); }) },
    prepare: jest.fn(async () => ({ id: intent, productId: "feature_7d", kind: "feature" as const, days: 7, expiresAt: new Date(Date.now() + 7200000).toISOString(), fulfilled: false, grantedUntil: null })),
    status: jest.fn(async () => null), submit: jest.fn(async () => ({ fulfilled: true, grantedUntil: granted })),
    native: { identify: jest.fn(async () => {}), identity: jest.fn(async () => buyer), buy: jest.fn(async () => ({ product: "feature_7d", transaction: "GPA.fixture" })) },
  };
  return { deps, data, checkout: createStagedSupabaseCheckout(deps), activate: (id: string | null) => { active = id; } };
}
const buy = (f: ReturnType<typeof setup>) => f.checkout.purchase(intent, restaurant, "feature_7d");
test("disabled staging never touches auth/storage/native/backend", async () => {
  const f = setup(); (f.deps.enabled as jest.Mock).mockReturnValue(false);
  expect(await buy(f)).toEqual({ status: "disabled" }); expect(f.deps.user).not.toHaveBeenCalled(); expect(f.deps.native.buy).not.toHaveBeenCalled();
});
test("intent is prepared before buying, journal durable before charge, only confirmed fulfillment is success", async () => {
  const f = setup();
  (f.deps.native.buy as jest.Mock).mockImplementation(async () => { expect(JSON.parse([...f.data.values()][0]).stage).toBe("purchasing"); return { product: "feature_7d", transaction: "GPA.fixture" }; });
  expect(await buy(f)).toEqual({ status: "fulfilled", grantedUntil: granted }); expect(f.deps.prepare).toHaveBeenCalledWith(intent, restaurant, "feature_7d");
  expect(f.deps.submit).toHaveBeenCalledWith(intent, "GPA.fixture", buyer); expect(f.data.size).toBe(0);
});
test("failed pre-charge storage prevents a purchase", async () => {
  const f = setup(); (f.deps.storage.setItem as jest.Mock).mockRejectedValue(new Error("disk full"));
  await expect(buy(f)).rejects.toThrow("disk full"); expect(f.deps.native.buy).not.toHaveBeenCalled();
});
test("unconfirmed payment remains durable across restart; retries submit but never rebuy", async () => {
  const f = setup(); (f.deps.submit as jest.Mock).mockResolvedValueOnce({ fulfilled: false });
  expect(await buy(f)).toEqual({ status: "pending" }); expect(JSON.parse([...f.data.values()][0]).transaction).toBe("GPA.fixture");
  const restarted = createStagedSupabaseCheckout(f.deps);
  expect(await restarted.retry()).toEqual({ status: "fulfilled", grantedUntil: granted }); expect(f.deps.native.buy).toHaveBeenCalledTimes(1);
});
test("timeout after store charge retains recovery marker and never buys again", async () => {
  const f = setup(); (f.deps.native.buy as jest.Mock).mockRejectedValue(new Error("uncertain store response"));
  expect(await buy(f)).toEqual({ status: "recovery_required" }); expect(await buy(f)).toEqual({ status: "recovery_required" }); expect(f.deps.native.buy).toHaveBeenCalledTimes(1);
  expect(await f.checkout.recover("feature_7d", "GPA.recovered")).toEqual({ status: "fulfilled", grantedUntil: granted }); expect(f.deps.submit).toHaveBeenCalledWith(intent, "GPA.recovered", buyer);
});
test("receipt-storage failure retains in-memory result and durable no-rebuy marker", async () => {
  const f = setup(); const save = f.deps.storage.setItem;
  (save as jest.Mock).mockImplementationOnce(async (key, value) => { f.data.set(key, value); }).mockRejectedValueOnce(new Error("disk full"));
  expect(await buy(f)).toEqual({ status: "pending" }); expect(JSON.parse([...f.data.values()][0]).stage).toBe("purchasing"); expect(f.deps.submit).not.toHaveBeenCalled();
  expect(await f.checkout.retry()).toEqual({ status: "fulfilled", grantedUntil: granted }); expect(f.deps.native.buy).toHaveBeenCalledTimes(1);
});
test("account switch before charge aborts; after charge preserves old account receipt", async () => {
  const f = setup(); (f.deps.native.identify as jest.Mock).mockImplementation(async () => { f.activate(other); });
  expect(await buy(f)).toEqual({ status: "session_changed" }); expect(f.deps.native.buy).not.toHaveBeenCalled();
  const g = setup(); (g.deps.native.buy as jest.Mock).mockImplementation(async () => { g.activate(other); return { product: "feature_7d", transaction: "GPA.fixture" }; });
  expect(await buy(g)).toEqual({ status: "session_changed" }); expect(g.deps.submit).not.toHaveBeenCalled();
  expect(JSON.parse([...g.data.values()][0]).stage).toBe("receipt");
  expect(await g.checkout.retry()).toEqual({ status: "pending" }); g.activate(buyer);
  expect(await g.checkout.retry()).toEqual({ status: "fulfilled", grantedUntil: granted });
});
test("SDK identity mismatch prevents charge", async () => {
  const f = setup(); (f.deps.native.identity as jest.Mock).mockResolvedValue(other);
  expect(await buy(f)).toEqual({ status: "session_changed" }); expect(f.deps.native.buy).not.toHaveBeenCalled();
});
test("logout denies submission without clearing another account journal", async () => {
  const f = setup(); (f.deps.submit as jest.Mock).mockResolvedValue({ fulfilled: false }); await buy(f); f.activate(null);
  expect(await f.checkout.retry()).toEqual({ status: "session_changed" }); expect(f.data.size).toBe(1);
});
test("cancelled store result clears marker but unrecognized errors do not", async () => {
  const f = setup(); (f.deps.native.buy as jest.Mock).mockRejectedValue({ userCancelled: true });
  expect(await buy(f)).toEqual({ status: "cancelled" }); expect(f.data.size).toBe(0);
});
test("concurrent operations cannot change SDK identity or start a second charge", async () => {
  const f = setup(); let release!: () => void;
  (f.deps.native.buy as jest.Mock).mockImplementation(async () => { await new Promise<void>(r => { release = r; }); return { product: "feature_7d", transaction: "GPA.fixture" }; });
  const first = buy(f); while (!release) await new Promise(r => setImmediate(r));
  expect(await buy(f)).toEqual({ status: "busy" }); expect(await f.checkout.retry()).toEqual({ status: "busy" }); release(); await first;
  expect(f.deps.native.buy).toHaveBeenCalledTimes(1);
});
test("server confirmation recovers a lost response without resubmitting or recharging", async () => {
  const f = setup(); (f.deps.submit as jest.Mock).mockRejectedValueOnce(new Error("network")); await buy(f);
  (f.deps.status as jest.Mock).mockResolvedValue({ fulfilled: true, grantedUntil: granted });
  expect(await f.checkout.retry()).toEqual({ status: "fulfilled", grantedUntil: granted }); expect(f.deps.submit).toHaveBeenCalledTimes(1); expect(f.deps.native.buy).toHaveBeenCalledTimes(1);
});
test("malformed journal or native receipt fails closed without automatic rebuy", async () => {
  const f = setup(); f.data.set(`hidden-plate:supabase-purchase:v1:${buyer}`, "not JSON"); await expect(buy(f)).rejects.toThrow(); expect(f.deps.native.buy).not.toHaveBeenCalled();
  const g = setup(); (g.deps.native.buy as jest.Mock).mockResolvedValue({ product: "wrong", transaction: "GPA.fixture" });
  expect(await buy(g)).toEqual({ status: "recovery_required" }); expect(g.deps.submit).not.toHaveBeenCalled();
});
test("saved receipt cannot be reassigned to a different product/transaction", async () => {
  const f = setup(); (f.deps.submit as jest.Mock).mockResolvedValue({ fulfilled: false }); await buy(f);
  await expect(f.checkout.recover("listing_1yr", "tx")).rejects.toThrow("matching"); await expect(f.checkout.recover("feature_7d", "other")).rejects.toThrow("replace");
});
