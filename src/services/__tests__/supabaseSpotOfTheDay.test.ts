import { supabase } from "@/services/supabase";
import { getSupabaseRestaurantById } from "@/services/supabaseRestaurants";
import { listSupabaseReviewsForRestaurant } from "@/services/supabaseReviews";
import { getSupabaseSpotConfig,setSupabaseSpotOfTheDay,resolveSupabaseSpotOfTheDay } from "@/services/supabaseSpotOfTheDay";
import { spotDayKey } from "@/utils/spotOfTheDay";
import type { Restaurant } from "@/types/restaurant";
jest.mock("@/services/supabase",() => ({ supabase:{ from:jest.fn(),rpc:jest.fn() } }));
jest.mock("@/services/supabaseDataRequest", () => ({ requestSupabaseRpc: (...args: unknown[]) => (supabase.rpc as jest.Mock)(...args) }));
jest.mock("@/services/supabaseRestaurants",() => ({ getSupabaseRestaurantById:jest.fn() }));
jest.mock("@/services/supabaseReviews",() => ({ listSupabaseReviewsForRestaurant:jest.fn() }));
const id="f9000000-0000-4000-8000-000000000001";
const restaurant={ id,isActive:true,averageRating:4.5,reviewCount:8,isFeatured:false,isVerified:true,plateImage:null } as Restaurant;
let query: Record<string,jest.Mock>;
beforeEach(() => {
  jest.resetAllMocks(); query={ select:jest.fn(),eq:jest.fn(),maybeSingle:jest.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.maybeSingle.mockResolvedValue({ data:null,error:null });
  (supabase.from as jest.Mock).mockReturnValue(query); (supabase.rpc as jest.Mock).mockResolvedValue({ error:null });
  (listSupabaseReviewsForRestaurant as jest.Mock).mockResolvedValue({ items:[] });
});
test("empty config preserves the automatic-pick contract",async () => {
  expect(await getSupabaseSpotConfig()).toEqual({ id:null,spotRestaurantId:null,spotDate:null,plateImage:null });
  expect(await resolveSupabaseSpotOfTheDay([restaurant])).toEqual({ restaurant,thumbnailImageId:null });
});
test("today's pinned thumbnail avoids a review fetch",async () => {
  query.maybeSingle.mockResolvedValue({ data:{ id:true,spot_of_day_restaurant_id:id,spot_date:spotDayKey(),plate_image_path:"rest/photo.jpg" },error:null });
  expect(await resolveSupabaseSpotOfTheDay([restaurant])).toEqual({ restaurant,thumbnailImageId:"rest/photo.jpg" });
  expect(listSupabaseReviewsForRestaurant).not.toHaveBeenCalled();
});
test("old pin images are not reused for automatic picks; review image fallback remains",async () => {
  query.maybeSingle.mockResolvedValue({ data:{ id:true,spot_of_day_restaurant_id:id,spot_date:"2000-01-01",plate_image_path:"old.jpg" },error:null });
  (listSupabaseReviewsForRestaurant as jest.Mock).mockResolvedValue({ items:[{ imageIds:["rev/review.jpg"] }] });
  expect((await resolveSupabaseSpotOfTheDay([restaurant]))?.thumbnailImageId).toBe("rev/review.jpg");
});
test("unavailable/inactive pins safely fall back; empty pool remains empty",async () => {
  query.maybeSingle.mockResolvedValue({ data:{ id:true,spot_of_day_restaurant_id:id },error:null });
  (getSupabaseRestaurantById as jest.Mock).mockResolvedValue({ ...restaurant,isActive:false });
  expect(await resolveSupabaseSpotOfTheDay([])).toBeNull();
  query.maybeSingle.mockRejectedValue(new Error("Offline"));
  expect((await resolveSupabaseSpotOfTheDay([restaurant]))?.restaurant.id).toBe(id);
});
test("pin writes use an admin RPC and clearing removes stale date/photo",async () => {
  await setSupabaseSpotOfTheDay(id,"2026-10-07","rest/photo.jpg");
  expect(supabase.rpc).toHaveBeenCalledWith("admin_set_spot_of_day",{ restaurant_id:id,pin_date:"2026-10-07",plate_path:"rest/photo.jpg" });
  await setSupabaseSpotOfTheDay(null,"invalid","old.jpg");
  expect(supabase.rpc).toHaveBeenLastCalledWith("admin_set_spot_of_day",{ restaurant_id:null,pin_date:null,plate_path:null });
});
