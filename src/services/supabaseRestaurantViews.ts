import { requestSupabaseRpc } from "@/services/supabaseDataRequest";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
// Analytics must never block the restaurant page or owner dashboard.
export async function recordSupabaseRestaurantView(restaurantId:string):Promise<void> {
  if (!SUPABASE_UUID.test(restaurantId)) return;
  try { await requestSupabaseRpc("record_restaurant_view",{target_restaurant:restaurantId}); } catch { /* non-fatal */ }
}
export async function getSupabaseRestaurantViewCount(restaurantId:string):Promise<number> {
  if (!SUPABASE_UUID.test(restaurantId)) return 0;
  try {
    const {data,error}=await requestSupabaseRpc("restaurant_view_count",{target_restaurant:restaurantId});
    return !error && Number.isFinite(Number(data)) ? Number(data) : 0;
  } catch { return 0; }
}
