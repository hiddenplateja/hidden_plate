import { supabase } from "@/services/supabase";
import { checkSupabaseIsAdmin } from "@/services/supabaseAdmin";
import { createSupabaseRestaurant, restaurantSupabasePayload, getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import { adminCreateSupabaseRestaurant, updateSupabaseRestaurant, listAdminSupabaseRestaurants, listClaimedSupabaseRestaurants,
  setSupabaseRestaurantOwner, setSupabaseRestaurantListingPaidUntil, deleteSupabaseRestaurant, bulkImportSupabaseRestaurants,
  rebuildSupabaseRestaurantSearch, approveSupabaseRestaurantSubmission } from "@/services/supabaseRestaurantAdmin";
import { processSupabaseMediaCleanup } from "@/services/supabaseStorage";
import * as Location from "expo-location";
import type { CreateRestaurantInput } from "@/types/restaurant";

jest.mock("@/services/supabase",() => ({ supabase:{ rpc:jest.fn(),from:jest.fn() } }));
// Payload/mapping tests only; real bulk-import session races are tested separately.
jest.mock("@/services/supabaseDataRequest", () => ({
  requestSupabaseRpc: (...args: unknown[]) => (supabase.rpc as jest.Mock)(...args),
  rpcForSupabaseDataSession: (_session: unknown, ...args: unknown[]) => (supabase.rpc as jest.Mock)(...args),
  requireSupabaseDataSession: async () => ({ userId: "fixture-admin", accessToken: "fixture-token", client: supabase }),
  assertSupabaseDataSession: jest.fn(),
}));
jest.mock("@/services/supabaseAdmin",() => ({ checkSupabaseIsAdmin:jest.fn() }));
jest.mock("@/services/supabaseStorage",() => ({ processSupabaseMediaCleanup:jest.fn() }));
jest.mock("expo-location",() => ({ geocodeAsync:jest.fn() }));
const rpc=supabase.rpc as jest.Mock;
const from=supabase.from as jest.Mock;
const id="f9000000-0000-4000-8000-000000000001";
const other="f9000000-0000-4000-8000-000000000002";
const input: CreateRestaurantInput={ name:"Fixture Spot",address:"Road",parish:"kingston",latitude:18,longitude:-77,cuisines:["Jamaican"],categories:[],imageIds:[] };
const row={ id,name:"Fixture Spot",created_at:"now",updated_at:"now",slug:"fixture",parish:"kingston",address:"Road",latitude:18,longitude:-77,
  cuisines:["jamaican"],categories:[],image_paths:[],menu:[],average_rating:4.5,review_count:7,is_active:true,is_verified:true,is_featured:false };
beforeEach(() => { jest.resetAllMocks(); rpc.mockResolvedValue({ data:[row],error:null }); (checkSupabaseIsAdmin as jest.Mock).mockResolvedValue(true); });

test("public payload cannot include any trust field, preserves omitted fields and null clears",async () => {
  expect(restaurantSupabasePayload({ city:null,name:"New",isActive:true,ownerId:other,averageRating:5 } as never,false))
    .toEqual({ city:null,name:"New" });
  const result=await createSupabaseRestaurant({ ...input,isActive:true,isVerified:true });
  expect(rpc.mock.calls[0][1].payload).not.toHaveProperty("is_active");
  expect(result).toMatchObject({ id,averageRating:4.5,reviewCount:7 });
});
test("admin create and edit only map supplied allowed fields",async () => {
  await adminCreateSupabaseRestaurant({ ...input,isActive:true });
  expect(rpc.mock.calls[0][1].payload.is_active).toBe(true);
  await updateSupabaseRestaurant(id,{ name:"New name",city:null,isFeatured:true,slug:"bad",reviewCount:99 } as never);
  expect(rpc).toHaveBeenLastCalledWith("admin_write_restaurant",{ target_id:id,payload:{ name:"New name",city:null,is_featured:true } });
});
test("approval uses the server-checked write path",async () => {
  await approveSupabaseRestaurantSubmission(id,{ verified:true });
  expect(rpc).toHaveBeenCalledWith("admin_write_restaurant",{ target_id:id,payload:{ is_active:true,is_verified:true } });
});
test("admin page searches literally, keeps total and uses lookahead",async () => {
  rpc.mockResolvedValue({ data:{ items:[row,{ ...row,id:other }],total:10 },error:null });
  const page=await listAdminSupabaseRestaurants({ search:"  %,_  ",pageSize:1,status:"pending",cursor:other });
  expect(page).toMatchObject({ hasMore:true,total:10,nextCursor:id }); expect(page.items).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("admin_restaurant_page",{ search_term:"%,_",filter_status:"pending",after_id:other,page_size:1,claimed_only:false });
  rpc.mockResolvedValue({ data:{ items:[row],total:1 },error:null }); expect((await listAdminSupabaseRestaurants({ pageSize:1 })).hasMore).toBe(false);
});
test("owners list fetches successive pages instead of silently truncating at 100",async () => {
  rpc.mockResolvedValueOnce({ data:{ items:Array.from({ length:101 },(_,i) => ({ ...row,id:i===99 ? other : id })),total:101 },error:null })
    .mockResolvedValueOnce({ data:{ items:[{ ...row,id:other }],total:101 },error:null });
  expect(await listClaimedSupabaseRestaurants()).toHaveLength(101);
  expect(rpc.mock.calls[1][1]).toMatchObject({ after_id:other,claimed_only:true });
});
test("invalid IDs/expiry fail early and ownership changes use dedicated RPC",async () => {
  await expect(setSupabaseRestaurantOwner("bad",other)).rejects.toThrow("Invalid restaurant");
  await expect(setSupabaseRestaurantListingPaidUntil(id,"nonsense")).rejects.toThrow("Invalid listing expiry");
  expect(rpc).not.toHaveBeenCalled();
  await setSupabaseRestaurantOwner(id,other); await setSupabaseRestaurantOwner(id,null);
  expect(rpc).toHaveBeenLastCalledWith("admin_set_restaurant_owner",{ target_id:id,new_owner:null });
  await setSupabaseRestaurantListingPaidUntil(id,null);
  expect(rpc).toHaveBeenLastCalledWith("admin_set_listing_expiry",{ target_id:id,paid_until:null });
});
test("database deletion stays successful when media cleanup is denied",async () => {
  rpc.mockResolvedValue({ data:["rest/foreign/file.jpg"],error:null });
  (processSupabaseMediaCleanup as jest.Mock).mockRejectedValue(new Error("403"));
  await expect(deleteSupabaseRestaurant(id)).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledWith("admin_delete_restaurant",{ target_id:id });
  expect(processSupabaseMediaCleanup).toHaveBeenCalledWith(expect.objectContaining({ userId: "fixture-admin", accessToken: "fixture-token" }));
  rpc.mockResolvedValue({ error:{ message:"Admin access required." } }); (processSupabaseMediaCleanup as jest.Mock).mockClear();
  await expect(deleteSupabaseRestaurant(id)).rejects.toThrow("Admin access required."); expect(processSupabaseMediaCleanup).not.toHaveBeenCalled();
});
test("imports gate admin before geocoding and isolate per-row failures",async () => {
  (checkSupabaseIsAdmin as jest.Mock).mockResolvedValue(false);
  await expect(bulkImportSupabaseRestaurants([input])).rejects.toThrow("Admin access required."); expect(Location.geocodeAsync).not.toHaveBeenCalled();
  (checkSupabaseIsAdmin as jest.Mock).mockResolvedValue(true);
  const result=await bulkImportSupabaseRestaurants([input,{ ...input,name:"x" },{ ...input,name:"Geocode",latitude:undefined,longitude:undefined }]);
  expect(result).toMatchObject({ created:1,failed:2 }); expect(result.errors[0]).toBe("x: missing name");
  expect(rpc.mock.calls[0][1].payload).toMatchObject({ is_active:true,is_verified:true,is_featured:false,image_paths:[] });
});
test("import geocode fallback retains the curated publish flags",async () => {
  (Location.geocodeAsync as jest.Mock).mockResolvedValue([{ latitude:18.1,longitude:-77.1 }]);
  expect(await bulkImportSupabaseRestaurants([{ ...input,latitude:undefined,longitude:undefined }])).toEqual({ created:1,failed:0,errors:[] });
  expect(rpc.mock.calls[0][1].payload).toMatchObject({ latitude:18.1,longitude:-77.1 });
});
test("search rebuilding returns maintenance counts",async () => {
  rpc.mockResolvedValue({ data:{ scanned:20,updated:4 },error:null }); expect(await rebuildSupabaseRestaurantSearch()).toEqual({ scanned:20,updated:4 });
});
test("batch restaurant hydration chunks ID lists below the API cap",async () => {
  const query={ select:jest.fn(),in:jest.fn() }; query.select.mockReturnValue(query); query.in.mockResolvedValue({ data:[row],error:null }); from.mockReturnValue(query);
  const ids=Array.from({ length:205 },(_,n) => `f9000000-0000-4000-8000-${n.toString().padStart(12,"0")}`);
  await getSupabaseRestaurantsByIds([...ids,"invalid",ids[0]]);
  expect(query.in.mock.calls.map(c => c[1].length)).toEqual([100,100,5]);
});
