import { verifyRevenueCatPurchase, type PurchaseExpectation, type VerifiedPurchaseProof } from "./purchaseVerification.ts";

type Row = Record<string, unknown>;
export type VerificationContext = PurchaseExpectation;
export type PurchaseEndpointDeps = {
  authenticate(): Promise<string | null>;
  // Must check the active caller and filter the private intent by that caller.
  context(buyer: string, intent: string): Promise<VerificationContext | null>;
  fulfill(intent: string, proof: VerifiedPurchaseProof): Promise<unknown>;
  secret(): string | undefined;
  fetch: typeof fetch;
};
export class PurchaseHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[\x21-\x7e]{1,255}$/;
// Streaming bounds apply even when Content-Length is missing or dishonest.
export async function boundedJson(body: Request | Response, limit: number): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(body.headers.get("content-type") ?? "")) throw new Error("Invalid JSON type");
  const declared = body.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error("Body too large");
  if (!body.body) throw new Error("Missing body");
  const reader = body.body.getReader(); const chunks: Uint8Array[] = []; let size = 0; let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 8000);
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error("Body too large"); chunks.push(value);
    }
    if (timedOut) throw new Error("JSON read timeout");
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
}
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
  return value as Row;
}
async function revenueCat(path: string, secret: string, transport: typeof fetch): Promise<unknown> {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await transport(`https://api.revenuecat.com/v2/${path}`, {
      method: "GET", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      redirect: "error", signal: abort.signal,
    });
    if (!response.ok) { await response.body?.cancel(); throw new PurchaseHttpError(503, "verification_unavailable"); }
    return await boundedJson(response, 131072);
  } catch { throw new PurchaseHttpError(503, "verification_unavailable"); }
  finally { clearTimeout(timer); }
}
const reply = (status: number, code: string, extra: Row = {}) => Response.json({ code, ...extra }, {
  status, headers: { "Cache-Control": "no-store", ...(status === 202 || status === 429 || status === 503 ? { "Retry-After": "10" } : {}) },
});
// All evidence is fetched from a fixed RevenueCat origin; no URL/proof/customer
// from the HTTP body is ever passed to the privileged database operation.
export async function handlePurchaseVerification(req: Request, deps: PurchaseEndpointDeps): Promise<Response> {
  if (req.method !== "POST") return reply(405, "method_not_allowed");
  try {
    const buyer = await deps.authenticate(); if (!buyer || !uuid.test(buyer)) return reply(401, "sign_in_required");
    let body: Row;
    try {
      body = object(await boundedJson(req, 2048));
      if (Object.keys(body).length !== 2 || typeof body.intentId !== "string" || !uuid.test(body.intentId)
        || typeof body.storeTransactionId !== "string" || !identifier.test(body.storeTransactionId)) throw new Error();
    } catch { return reply(400, "invalid_request"); }
    const intentId = body.intentId as string; const transaction = body.storeTransactionId as string;
    const context = await deps.context(buyer, intentId); if (!context) return reply(404, "intent_unavailable");
    // Defense in depth: context is server-owned and must belong to this JWT.
    if (context.buyerId !== buyer || !identifier.test(context.projectId)) throw new PurchaseHttpError(503, "payments_disabled");
    const secret = deps.secret(); if (!secret || /[\r\n]/.test(secret)) return reply(503, "payments_disabled");
    const search = object(await revenueCat(`projects/${encodeURIComponent(context.projectId)}/purchases?store_purchase_identifier=${encodeURIComponent(transaction)}`, secret, deps.fetch));
    if (search.object === "list" && Array.isArray(search.items) && search.items.length === 0 && !search.next_page) return reply(202, "verification_pending");
    if (search.object !== "list" || !Array.isArray(search.items) || search.items.length !== 1 || search.next_page) return reply(422, "purchase_not_verified");
    const productId = object(search.items[0]).product_id;
    if (typeof productId !== "string" || !identifier.test(productId)) return reply(422, "purchase_not_verified");
    const product = await revenueCat(`projects/${encodeURIComponent(context.projectId)}/products/${encodeURIComponent(productId)}`, secret, deps.fetch);
    let proof: VerifiedPurchaseProof;
    try { proof = verifyRevenueCatPurchase(search, product, { ...context, storeTransactionId: transaction }); }
    catch { return reply(422, "purchase_not_verified"); }
    const result = object(await deps.fulfill(intentId, proof));
    if (result.fulfilled !== true || typeof result.granted_until !== "string" || !Number.isFinite(Date.parse(result.granted_until))) throw new Error();
    return reply(200, "fulfilled", { fulfilled: true, grantedUntil: result.granted_until });
  } catch (error) {
    // Never disclose JWTs, credentials, upstream payloads or raw DB errors.
    return error instanceof PurchaseHttpError ? reply(error.status, error.code) : reply(503, "verification_unavailable");
  }
}
