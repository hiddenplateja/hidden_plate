import { boundedJson, handlePurchaseVerification, PurchaseHttpError, type PurchaseEndpointDeps } from "./purchaseEndpoint.ts";
const buyer = "fc260000-0000-4000-8000-000000000001";
const intent = "fc261000-0000-4000-8000-000000000001";
const granted = "2026-11-01T12:00:00Z";
const json = (data: unknown, status = 200) => Response.json(data, { status });
const request = (body: unknown = { intentId: intent, storeTransactionId: "GPA.fixture" }) => new Request("https://fixture.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function assert(value: unknown, label: string) { if (!value) throw new Error(label); }
function setup() {
  const now = Date.now(); let calls = 0; let grants = 0; const urls: string[] = [];
  const purchase = { object: "purchase", id: "purch-fixture", customer_id: buyer, original_customer_id: buyer, product_id: "prod-fixture",
    purchased_at: now, quantity: 1, status: "owned", ownership: "purchased", environment: "sandbox", store: "play_store", store_purchase_identifier: "GPA.fixture" };
  const product = { object: "product", state: "active", id: "prod-fixture", app_id: "app-fixture", type: "consumable", store_identifier: "feature_7d" };
  const responses: Response[] = [json({ object: "list", items: [purchase] }), json(product)];
  const deps: PurchaseEndpointDeps = {
    authenticate: async () => buyer,
    context: async () => ({ projectId: "proj-fixture", buyerId: buyer, productId: "feature_7d", storeTransactionId: "", environment: "SANDBOX",
      allowedApps: { "app-fixture": "PLAY_STORE" }, createdAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 7200000).toISOString() }),
    secret: () => "fixture-secret",
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url)); calls++;
      assert(init?.method === "GET" && init.redirect === "error" && init.signal instanceof AbortSignal, "Unsafe fetch options");
      assert((init?.headers as Record<string, string>).Authorization === "Bearer fixture-secret", "Missing server credential");
      return responses.shift()!;
    }) as typeof fetch,
    fulfill: async (id, proof) => {
      grants++; assert(id === intent && proof.buyer_id === buyer && Object.keys(proof).length === 9, "Unsafe grant inputs");
      return { fulfilled: true, granted_until: granted };
    },
  };
  return { deps, responses, urls, purchase, product, calls: () => calls, grants: () => grants };
}
Deno.test("endpoint fetches exact store purchase and server product, grants only verified minimal proof", async () => {
  const f = setup(); const response = await handlePurchaseVerification(request(), f.deps); const body = await response.json();
  assert(response.status === 200 && body.grantedUntil === granted && f.calls() === 2 && f.grants() === 1, "Valid verification failed");
  assert(f.urls[0] === "https://api.revenuecat.com/v2/projects/proj-fixture/purchases?store_purchase_identifier=GPA.fixture"
    && f.urls[1] === "https://api.revenuecat.com/v2/projects/proj-fixture/products/prod-fixture", "Wrong fixed origin/routes");
  assert(response.headers.get("cache-control") === "no-store", "Purchase response cached");
});
for (const [label, change, code] of [
  ["signed out", (d: PurchaseEndpointDeps) => { d.authenticate = async () => null; }, 401],
  ["disabled", (d: PurchaseEndpointDeps) => { d.context = async () => { throw new PurchaseHttpError(503, "payments_disabled"); }; }, 503],
  ["throttled", (d: PurchaseEndpointDeps) => { d.context = async () => { throw new PurchaseHttpError(429, "retry_later"); }; }, 429],
  ["inactive", (d: PurchaseEndpointDeps) => { d.context = async () => { throw new PurchaseHttpError(403, "active_account_required"); }; }, 403],
  ["other intent", (d: PurchaseEndpointDeps) => { d.context = async () => null; }, 404],
  ["missing secret", (d: PurchaseEndpointDeps) => { d.secret = () => undefined; }, 503],
] as const) Deno.test(`endpoint rejects ${label} without upstream calls or grants`, async () => {
  const f = setup(); change(f.deps); assert((await handlePurchaseVerification(request(), f.deps)).status === code && f.calls() === 0 && f.grants() === 0, "Gate failed");
});
Deno.test("client cannot provide buyer, product, arbitrary URL or verified proof", async () => {
  for (const body of [null, [], {}, { intentId: intent, storeTransactionId: "GPA.fixture", proof: {} }, { intentId: intent, storeTransactionId: "bad\nvalue" }, { intentId: "bad", storeTransactionId: "tx" }]) {
    const f = setup(); assert((await handlePurchaseVerification(request(body), f.deps)).status === 400 && f.calls() === 0, "Injected request accepted");
  }
});
Deno.test("method and JSON type are bounded before verification", async () => {
  const f = setup(); assert((await handlePurchaseVerification(new Request("https://fixture.test"), f.deps)).status === 405, "GET accepted");
  const text = new Request("https://fixture.test", { method: "POST", body: "{}" });
  assert((await handlePurchaseVerification(text, f.deps)).status === 400, "Non-JSON accepted");
  assert((await handlePurchaseVerification(request({ intentId: intent, storeTransactionId: "x".repeat(3000) }), f.deps)).status === 400, "Oversized accepted");
});
Deno.test("not yet visible store purchase stays pending and never grants", async () => {
  const f = setup(); f.responses[0] = json({ object: "list", items: [] });
  const response = await handlePurchaseVerification(request(), f.deps);
  assert(response.status === 202 && response.headers.get("retry-after") === "10" && f.calls() === 1 && f.grants() === 0, "Missing purchase mishandled");
});
for (const status of [401, 403, 404, 429, 500, 503]) Deno.test(`upstream ${status} is retryable and safe`, async () => {
  const f = setup(); f.responses[0] = json({ secret: "sensitive upstream detail" }, status);
  const response = await handlePurchaseVerification(request(), f.deps);
  assert(response.status === 503 && !(await response.text()).includes("sensitive") && f.grants() === 0, "Upstream failure leaked/granted");
});
Deno.test("timeouts, redirects and malformed/oversized upstream responses fail closed", async () => {
  for (const response of [new Response("not-json", { headers: { "Content-Type": "application/json" } }), new Response("x".repeat(131073), { headers: { "Content-Type": "application/json" } }), new Response("{}"), new Response(null, { status: 302, headers: { Location: "https://unsafe.test" } })]) {
    const f = setup(); f.responses[0] = response;
    assert((await handlePurchaseVerification(request(), f.deps)).status === 503 && f.grants() === 0, "Unsafe upstream accepted");
  }
  const f = setup(); f.deps.fetch = async () => { throw new DOMException("fixture timeout", "AbortError"); };
  assert((await handlePurchaseVerification(request(), f.deps)).status === 503, "Timeout not retryable");
});
Deno.test("ambiguous and continued search cannot select an arbitrary purchase", async () => {
  for (const search of [{ object: "list", items: [setup().purchase, setup().purchase] }, { object: "list", items: [setup().purchase], next_page: "/next" }]) {
    const f = setup(); f.responses[0] = json(search); assert((await handlePurchaseVerification(request(), f.deps)).status === 422 && f.grants() === 0, "Ambiguity accepted");
  }
});
Deno.test("verified buyer/product mismatch never reaches fulfillment", async () => {
  const f = setup(); f.responses[1] = json({ ...f.product, store_identifier: "wrong" });
  assert((await handlePurchaseVerification(request(), f.deps)).status === 422 && f.grants() === 0, "Product mismatch granted");
});
Deno.test("failed or malformed database confirmation cannot report success", async () => {
  for (const fulfill of [async () => { throw new Error("private DB detail"); }, async () => ({ fulfilled: true, granted_until: "invalid" })]) {
    const f = setup(); f.deps.fulfill = fulfill;
    const response = await handlePurchaseVerification(request(), f.deps); assert(response.status === 503 && !(await response.text()).includes("private"), "False success/error disclosure");
  }
});
Deno.test("streaming limits apply without Content-Length", async () => {
  let denied = false;
  try { await boundedJson(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(50)); c.enqueue(new Uint8Array(60)); c.close(); } }), { headers: { "Content-Type": "application/json" } }), 100); }
  catch { denied = true; }
  assert(denied, "Unbounded stream accepted");
});
