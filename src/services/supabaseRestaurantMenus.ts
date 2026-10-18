import { supabase } from "@/services/supabase";
import { supabaseCommand, SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import type { MenuSection } from "@/types/restaurant";

export async function getSupabaseOwnerMenu(restaurantId: string): Promise<MenuSection[] | null> {
  if (!SUPABASE_UUID.test(restaurantId)) return null;
  try {
    const { data, error } = await supabase.from("restaurant_menus").select("menu").eq("restaurant_id", restaurantId).maybeSingle();
    return error || !Array.isArray(data?.menu) ? null : data.menu as MenuSection[];
  } catch { return null; }
}
export async function updateMySupabaseRestaurantMenu(restaurantId: string, menu: MenuSection[]): Promise<void> {
  if (!SUPABASE_UUID.test(restaurantId)) throw new Error("Invalid restaurant.");
  await supabaseCommand("update_owner_restaurant_menu", { target_restaurant: restaurantId, menu_value: menu });
}
