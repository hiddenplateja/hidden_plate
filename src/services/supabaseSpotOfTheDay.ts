import { supabase } from "@/services/supabase";
import { supabaseCommand, SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { getSupabaseRestaurantById } from "@/services/supabaseRestaurants";
import { listSupabaseReviewsForRestaurant } from "@/services/supabaseReviews";
import { pickSpotOfTheDay, seededIndex, spotDayKey } from "@/utils/spotOfTheDay";
import type { Restaurant } from "@/types/restaurant";
import type { SpotConfig, SpotOfTheDay } from "@/services/spotOfTheDay";

export async function getSupabaseSpotConfig(): Promise<SpotConfig | null> {
  try {
    const { data,error } = await supabase.from("app_config").select("id,spot_of_day_restaurant_id,spot_date,plate_image_path").eq("id",true).maybeSingle();
    if (error) return null;
    return { id:data ? "true" : null,spotRestaurantId:data?.spot_of_day_restaurant_id ?? null,
      spotDate:data?.spot_date ?? null,plateImage:data?.plate_image_path ?? null };
  } catch { return null; }
}
export async function setSupabaseSpotOfTheDay(id: string | null,date: string | null = null,plate: string | null = null): Promise<void> {
  if (id!==null && !SUPABASE_UUID.test(id)) throw new Error("Invalid restaurant ID.");
  if (id && date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use YYYY-MM-DD for the date.");
  await supabaseCommand("admin_set_spot_of_day",{ restaurant_id:id,pin_date:id ? date : null,plate_path:id ? plate : null });
}
export async function resolveSupabaseSpotOfTheDay(pool: Restaurant[]): Promise<SpotOfTheDay | null> {
  const config=await getSupabaseSpotConfig(); let pinned=false; let restaurant: Restaurant | null=null;
  if (config?.spotRestaurantId && (!config.spotDate || config.spotDate===spotDayKey())) {
    restaurant=pool.find(r => r.id===config.spotRestaurantId && r.isActive) ?? null;
    if (!restaurant) {
      try { const fetched=await getSupabaseRestaurantById(config.spotRestaurantId); if (fetched.isActive) restaurant=fetched; }
      catch { /* Missing/stale pins fall back to the existing daily rotation. */ }
    }
    pinned=!!restaurant;
  }
  restaurant ??= pickSpotOfTheDay(pool.filter(r => r.isActive));
  if (!restaurant) return null;
  let image=(pinned ? config?.plateImage?.trim() : null) || restaurant.plateImage?.trim() || null;
  if (!image) {
    try {
      const page=await listSupabaseReviewsForRestaurant(restaurant.id,{ pageSize:40,sort:"recent" });
      const images=page.items.flatMap(r => r.imageIds);
      if (images.length) image=images[seededIndex(spotDayKey()+restaurant.id,images.length)];
    } catch { /* No thumbnail must not break the home screen. */ }
  }
  return { restaurant,thumbnailImageId:image };
}
