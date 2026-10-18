import { PurchaseHttpError, type PurchaseEndpointDeps } from "./purchaseEndpoint.ts";
type Result = { data: unknown; error: unknown };
type Query = {
  eq(column: string, value: unknown): Query;
  single(): PromiseLike<Result>; maybeSingle(): PromiseLike<Result>;
};
export type PurchaseContextClients = {
  supabase: { auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> }; rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> };
  supabaseAdmin: { from(table: string): { select(fields: string): Query }; rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> };
};
const row = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function purchaseEndpointDependencies(ctx: PurchaseContextClients, env: (key: string) => string | undefined, transport: typeof fetch): PurchaseEndpointDeps {
  return {
    authenticate: async () => {
      const { data, error } = await ctx.supabase.auth.getUser(); return error ? null : data.user?.id ?? null;
    },
    context: async (buyer, intentId) => {
      if (env("PURCHASE_VERIFICATION_ENABLED") !== "true") throw new PurchaseHttpError(503, "payments_disabled");
      const { data: status, error: statusError } = await ctx.supabase.rpc("my_purchase_intent", { target_intent: intentId });
      if (statusError) throw new PurchaseHttpError(403, "active_account_required");
      if (!status) return null;
      const { data: rawSettings, error: settingsError } = await ctx.supabaseAdmin.from("purchase_settings")
        .select("enabled,rc_project_id,allowed_apps,environment").eq("id", true).single();
      const settings = row(rawSettings); const apps = row(settings?.allowed_apps);
      if (settingsError || settings?.enabled !== true || typeof settings.rc_project_id !== "string" || !settings.rc_project_id || !apps
        || !Object.values(apps).every(store => store === "APP_STORE" || store === "PLAY_STORE")
        || (settings.environment !== "SANDBOX" && settings.environment !== "PRODUCTION")) throw new PurchaseHttpError(503, "payments_disabled");
      const { data: rawIntent, error: intentError } = await ctx.supabaseAdmin.from("purchase_intents")
        .select("buyer_id,product_id,created_at,expires_at").eq("id", intentId).eq("buyer_id", buyer).maybeSingle();
      if (intentError) throw new PurchaseHttpError(503, "verification_unavailable");
      const intent = row(rawIntent); if (!intent) return null;
      if (intent.buyer_id !== buyer || typeof intent.product_id !== "string" || typeof intent.created_at !== "string" || typeof intent.expires_at !== "string") throw new PurchaseHttpError(503, "verification_unavailable");
      const { data: slot, error: slotError } = await ctx.supabaseAdmin.rpc("take_purchase_verification_slot", { buyer });
      if (slotError) throw new PurchaseHttpError(503, "verification_unavailable");
      if (slot !== true) throw new PurchaseHttpError(429, "retry_later");
      return { projectId: settings.rc_project_id, buyerId: buyer, productId: intent.product_id,
        storeTransactionId: "", environment: settings.environment, allowedApps: apps as Record<string, "APP_STORE" | "PLAY_STORE">,
        createdAt: intent.created_at, expiresAt: intent.expires_at };
    },
    fulfill: async (intentId, proof) => {
      const { data, error } = await ctx.supabaseAdmin.rpc("fulfill_verified_purchase", { target_intent: intentId, proof });
      if (error) throw new PurchaseHttpError(503, "fulfillment_needs_retry"); return data;
    },
    secret: () => env("REVENUECAT_V2_READ_SECRET"), fetch: transport,
  };
}
