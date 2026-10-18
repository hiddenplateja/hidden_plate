import { supabaseCommand, supabaseQueuePage, SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { requireSupabaseDataSession, requestSupabaseRpc, restForSupabaseDataSession } from "@/services/supabaseDataRequest";
import type { QueueOptions } from "@/services/supabaseAdminQueue";
import type { ClaimRole, ClaimStatus, CreateClaimInput, RestaurantClaim } from "@/services/claims";

type ClaimRow = {
  id: string; restaurant_id: string; user_id: string; status: ClaimStatus; contact_name: string | null;
  contact_phone: string | null; contact_email: string | null; claimant_role: ClaimRole | null;
  proof_note: string | null; message?: string | null; created_at: string; reviewed_at: string | null; reviewed_by: string | null;
};
function mapClaim(r: ClaimRow): RestaurantClaim {
  return { id: r.id, restaurantId: r.restaurant_id, userId: r.user_id, status: r.status,
    contactName: r.contact_name ?? "", contactPhone: r.contact_phone ?? "", contactEmail: r.contact_email ?? "",
    role: r.claimant_role ?? "owner", proofNote: r.proof_note ?? r.message ?? null,
    createdAt: r.created_at, reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by ?? null };
}
export async function createSupabaseClaim(input: CreateClaimInput): Promise<RestaurantClaim> {
  if (!SUPABASE_UUID.test(input.restaurantId)) throw new Error("Invalid restaurant.");
  const { data, error } = await requestSupabaseRpc("submit_restaurant_claim", { claim_payload: {
    restaurant_id: input.restaurantId, contact_name: input.contactName.trim(), contact_phone: input.contactPhone.trim(),
    contact_email: input.contactEmail.trim().toLowerCase(), claimant_role: input.role, proof_note: input.proofNote?.trim() || null,
  } });
  if (error) throw new Error(error.message);
  // PostgREST represents a composite row as a one-element array by default.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new Error("Couldn't submit your claim.");
  return mapClaim(row as ClaimRow);
}
export async function getMySupabaseClaimForRestaurant(id: string): Promise<RestaurantClaim | null> {
  if (!SUPABASE_UUID.test(id)) return null;
  try {
    const pinned = await requireSupabaseDataSession();
    const { data, error } = await restForSupabaseDataSession(pinned, client => client.from("restaurant_claims").select("*").eq("restaurant_id", id)
      .eq("user_id", pinned.userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1));
    return error || !data?.length ? null : mapClaim(data[0] as ClaimRow);
  } catch { return null; }
}
export const listSupabaseClaims = (opts: QueueOptions & { status?: ClaimStatus } = {}) =>
  supabaseQueuePage<ClaimRow, RestaurantClaim>("claim", mapClaim, opts, opts.status ?? "pending");
export async function approveSupabaseClaim(claim: RestaurantClaim): Promise<void> {
  if (!SUPABASE_UUID.test(claim.id)) throw new Error("Invalid claim.");
  // One transaction derives claimant/restaurant from the stored row, sets owner,
  // preserves menu contents, grants the 30-day grace period and marks approved.
  await supabaseCommand("admin_review_claim", { claim_id: claim.id, decision: "approved" });
}
export async function rejectSupabaseClaim(claim: RestaurantClaim): Promise<void> {
  if (!SUPABASE_UUID.test(claim.id)) throw new Error("Invalid claim.");
  await supabaseCommand("admin_review_claim", { claim_id: claim.id, decision: "rejected" });
}
export async function countSupabasePendingClaims(): Promise<number> {
  try {
    const { data, error } = await requestSupabaseRpc("admin_dashboard_stats");
    return error ? 0 : data?.claims ?? 0;
  } catch { return 0; }
}
