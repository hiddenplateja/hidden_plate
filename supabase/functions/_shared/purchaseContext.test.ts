import { purchaseEndpointDependencies, type PurchaseContextClients } from "./purchaseContext.ts";
const buyer = "fc260000-0000-4000-8000-000000000001"; const intent = "fc261000-0000-4000-8000-000000000001";
function assert(value: unknown, label: string) { if (!value) throw new Error(label); }
function fixture() {
  const events: string[] = []; const values = {
    status: { data: { id: intent }, error: null as unknown },
    settings: { data: { enabled: true, rc_project_id: "proj-fixture", allowed_apps: { "app-fixture": "PLAY_STORE" }, environment: "SANDBOX" }, error: null as unknown },
    intent: { data: { buyer_id: buyer, product_id: "feature_7d", created_at: "2026-10-12T12:00:00Z", expires_at: "2026-10-12T14:00:00Z" }, error: null as unknown },
    slot: { data: true as unknown, error: null as unknown },
  };
  const ctx: PurchaseContextClients = {
    supabase: { auth: { getUser: async () => ({ data: { user: { id: buyer } }, error: null }) }, rpc: async (name, args) => { events.push(`caller:${name}:${args.target_intent}`); return values.status; } },
    supabaseAdmin: {
      from: table => {
        events.push(`table:${table}`); const result = table === "purchase_settings" ? values.settings : values.intent;
        const query = {
          select: () => query, eq: (column: string, value: unknown) => { events.push(`${table}:${column}:${value}`); return query; },
          single: async () => result, maybeSingle: async () => result,
          then: Promise.resolve(result).then.bind(Promise.resolve(result)),
        };
        return query;
      },
      rpc: async (name, args) => { events.push(`admin:${name}:${args.buyer}`); return values.slot; },
    },
  };
  const env: Record<string, string> = { PURCHASE_VERIFICATION_ENABLED: "true", REVENUECAT_V2_READ_SECRET: "fixture-secret" };
  return { ctx, env, values, events, deps: purchaseEndpointDependencies(ctx, key => env[key], fetch) };
}
Deno.test("network auth and caller-scoped guard precede privileged, buyer-filtered context and distributed budget", async () => {
  const f = fixture(); assert(await f.deps.authenticate() === buyer, "Auth did not use getUser");
  const result = await f.deps.context(buyer, intent);
  assert(result?.buyerId === buyer && result.productId === "feature_7d", "Wrong intent context");
  assert(f.events[0] === `caller:my_purchase_intent:${intent}` && f.events.includes(`purchase_intents:id:${intent}`)
    && f.events.includes(`purchase_intents:buyer_id:${buyer}`) && f.events.at(-1) === `admin:take_purchase_verification_slot:${buyer}`, "Unfiltered privileged access");
});
Deno.test("disabled server flag denies before any database context query", async () => {
  const f = fixture(); delete f.env.PURCHASE_VERIFICATION_ENABLED;
  let denied = false; try { await f.deps.context(buyer, intent); } catch { denied = true; }
  assert(denied && f.events.length === 0, "Server switch bypassed");
});
Deno.test("inactive/unknown intent denies before private settings or intent reads", async () => {
  for (const inactive of [true, false]) {
    const f = fixture(); if (inactive) f.values.status.error = new Error("inactive"); else f.values.status.data = null as unknown as { id: string };
    let unavailable = false; try { unavailable = await f.deps.context(buyer, intent) === null; } catch { unavailable = true; }
    assert(unavailable && f.events.length === 1, "Private access before active owner guard");
  }
});
Deno.test("disabled/malformed route and foreign buyer cannot yield trusted context", async () => {
  const f = fixture(); f.values.settings.data.enabled = false;
  let denied = false; try { await f.deps.context(buyer, intent); } catch { denied = true; }
  assert(denied && !f.events.includes("table:purchase_intents"), "Disabled route exposed intent");
  const g = fixture(); g.values.intent.data.buyer_id = "other";
  denied = false; try { await g.deps.context(buyer, intent); } catch { denied = true; }
  assert(denied && !g.events.some(e => e.startsWith("admin:")), "Foreign buyer reserved slot");
});
Deno.test("failed/exhausted budget fails closed without trusted context", async () => {
  for (const failure of [true, false]) {
    const f = fixture(); if (failure) f.values.slot.error = new Error("RPC missing"); else f.values.slot.data = false;
    let denied = false; try { await f.deps.context(buyer, intent); } catch { denied = true; }
    assert(denied, "Budget bypassed");
  }
});
