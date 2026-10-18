// Display configuration only. Never grants paid placement or changes payment routing.
import { supabase } from "@/services/supabase";
import { readSupabaseAppConfiguration } from "@/services/supabaseAppConfiguration";
import type { FeaturePlan } from "@/services/featuring";
import type { ListingPlan } from "@/services/listing";

const featureDefaults: FeaturePlan[] = [
  { id: "7d", label: "7 days", days: 7, amount: 2500, currency: "JMD", productId: "feature_7d" },
  { id: "30d", label: "30 days", days: 30, amount: 8000, currency: "JMD", badge: "Best value", productId: "feature_30d" },
];
const listingDefaults: ListingPlan[] = [
  { id: "1yr", label: "1 year", days: 365, amount: 5000, currency: "JMD", productId: "listing_1yr" },
];
type Plan = FeaturePlan | ListingPlan;
type DisplayCatalog = { feature_plans?: unknown; listing_plans?: unknown };
function validPlans(value: unknown, listing: boolean): value is Plan[] {
  if (!Array.isArray(value) || !value.length || value.length > 50) return false;
  const ids = new Set<string>(); const products = new Set<string>();
  return value.every(p => {
    if (!p || typeof p !== "object" || Array.isArray(p)) return false;
    if (Object.keys(p).some(k => !["id", "label", "days", "amount", "currency", "badge", "productId"].includes(k))) return false;
    if (typeof p.id !== "string" || !p.id.trim() || p.id.length > 100 || ids.has(p.id)
      || typeof p.label !== "string" || !p.label.trim() || p.label.length > 100
      || !Number.isInteger(p.days) || p.days < 1 || p.days > 3650
      || typeof p.amount !== "number" || !Number.isFinite(p.amount) || p.amount < 0 || p.amount > 1e9
      || typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency)) return false;
    if (p.badge !== undefined && (typeof p.badge !== "string" || p.badge.length > 100)) return false;
    if (listing && p.productId === undefined) return false;
    if (p.productId !== undefined && (typeof p.productId !== "string" || p.productId.length > 200
      || !/^[A-Za-z0-9._-]+$/.test(p.productId) || products.has(p.productId))) return false;
    ids.add(p.id); if (p.productId !== undefined) products.add(p.productId);
    return true;
  });
}
export async function getSupabasePaymentPlans(): Promise<{ feature: FeaturePlan[]; listing: ListingPlan[] }> {
  let data: DisplayCatalog | null = null;
  try {
    data = await readSupabaseAppConfiguration() as DisplayCatalog | null;
  } catch { /* Missing/offline config preserves the built-in display plans. */ }
  return {
    feature: validPlans(data?.feature_plans, false) ? data!.feature_plans as FeaturePlan[] : featureDefaults.map(p => ({ ...p })),
    listing: validPlans(data?.listing_plans, true) ? data!.listing_plans as ListingPlan[] : listingDefaults.map(p => ({ ...p })),
  };
}
export async function getSupabaseFeaturePlans(): Promise<FeaturePlan[]> { return (await getSupabasePaymentPlans()).feature; }
export async function getSupabaseListingPlans(): Promise<ListingPlan[]> { return (await getSupabasePaymentPlans()).listing; }
export async function patchSupabasePaymentPlans(payload: { feature_plans?: FeaturePlan[] | null; listing_plans?: ListingPlan[] | null }): Promise<void> {
  for (const [kind, plans] of Object.entries(payload)) {
    if (!["feature_plans", "listing_plans"].includes(kind) || (plans !== null && (!Array.isArray(plans) || (plans.length && !validPlans(plans, kind === "listing_plans"))))) {
      throw new Error("Invalid plan catalog.");
    }
  }
  const { error } = await supabase.rpc("admin_patch_display_plans", { payload });
  if (error) throw new Error(error.message);
}
