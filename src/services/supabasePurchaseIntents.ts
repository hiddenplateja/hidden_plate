// Intent/status preparation only. No RevenueCat SDK import or store purchase.
import { supabase } from "@/services/supabase";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
export interface SupabasePurchaseIntent {
  id: string; productId: string; kind: "feature" | "listing"; days: number;
  expiresAt: string; fulfilled: boolean; grantedUntil: string | null;
}
function mapIntent(data: unknown): SupabasePurchaseIntent {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Couldn't load purchase intent.");
  const row = data as Record<string, unknown>;
  if (typeof row.id !== "string" || !SUPABASE_UUID.test(row.id) || typeof row.product_id !== "string"
    || !/^[A-Za-z0-9._-]{1,200}$/.test(row.product_id) || !["feature", "listing"].includes(row.kind as string)
    || !Number.isInteger(row.days) || (row.days as number) < 1 || (row.days as number) > 3650
    || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)) || typeof row.fulfilled !== "boolean"
    || (row.granted_until != null && (typeof row.granted_until !== "string" || !Number.isFinite(Date.parse(row.granted_until))))) throw new Error("Invalid purchase intent response.");
  return { id: row.id, productId: row.product_id, kind: row.kind as "feature" | "listing", days: row.days as number,
    expiresAt: row.expires_at, fulfilled: row.fulfilled, grantedUntil: row.granted_until as string | null ?? null };
}
export async function prepareSupabasePurchaseIntent(requestId: string, restaurantId: string, productId: string): Promise<SupabasePurchaseIntent> {
  if (!SUPABASE_UUID.test(requestId) || !SUPABASE_UUID.test(restaurantId) || !/^[A-Za-z0-9._-]{1,200}$/.test(productId)) throw new Error("Invalid purchase intent.");
  const { data, error } = await supabase.rpc("prepare_purchase_intent", { request_id: requestId, target_restaurant: restaurantId, store_product: productId });
  if (error) throw new Error(error.message);
  const result = mapIntent(data);
  if (result.id.toLowerCase() !== requestId.toLowerCase() || result.productId !== productId) throw new Error("Purchase intent did not match this request.");
  return result;
}
export async function getMySupabasePurchaseIntent(id: string): Promise<SupabasePurchaseIntent | null> {
  if (!SUPABASE_UUID.test(id)) throw new Error("Invalid purchase intent.");
  const { data, error } = await supabase.rpc("my_purchase_intent", { target_intent: id });
  if (error) throw new Error(error.message);
  if (data == null) return null;
  const result = mapIntent(data);
  if (result.id.toLowerCase() !== id.toLowerCase()) throw new Error("Purchase intent did not match this request.");
  return result;
}
