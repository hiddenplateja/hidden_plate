// Supabase admin-role lookup. The profile row is readable only through the
// existing RLS policy, and the role is assigned server-side by an admin.

import { requireSupabaseDataSession, requestSupabaseRpc, rpcForSupabaseDataSession, type SupabaseDataSession } from "@/services/supabaseDataRequest";
import type { AdminStats } from "@/services/admin";

/** Complete dashboard contract; Postgres checks active-admin authority. */
export async function getSupabaseAdminStats(): Promise<AdminStats> {
  const { data, error } = await requestSupabaseRpc("admin_dashboard_stats");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Couldn't load admin statistics.");
  return data as AdminStats;
}

export async function checkSupabaseIsAdmin(expected?: SupabaseDataSession): Promise<boolean> {
  try {
    const pinned = expected ?? await requireSupabaseDataSession();
    const { data, error } = await rpcForSupabaseDataSession(pinned, "is_admin");
    return !error && data === true;
  } catch { return false; }
}

/** Counts for migrated tables. Reports are excluded until their tables migrate. */
export async function getSupabaseAdminCoreStats() {
  const pinned = await requireSupabaseDataSession();
  if (!(await checkSupabaseIsAdmin(pinned))) throw new Error("Admin access required.");
  const { data, error } = await rpcForSupabaseDataSession(pinned, "admin_dashboard_stats");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Couldn't load admin statistics.");
  const { restaurantsTotal: total, restaurantsActive: active, reviews, users, claims } = data as AdminStats;
  return { restaurantsTotal: total, restaurantsActive: active, restaurantsPending: total - active, reviews, users, claims };
}

export async function approveSupabaseRestaurant(id: string, verified = false): Promise<void> {
  const { error } = await requestSupabaseRpc("admin_write_restaurant", { target_id:id,
    payload:{ is_active:true,...(verified ? { is_verified:true } : {}) } });
  if (error) throw new Error(error.message);
}
