import { supabase } from "@/services/supabase";
import { getSupabaseImageUrl } from "@/services/supabaseMediaUrls";
import { getSupabaseCollectionWithRestaurants, changeSupabaseCollectionMembership } from "@/services/supabaseCollections";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import { getSupabaseReviewStatsForRestaurants } from "@/services/supabaseReviews";
import { getSupabaseUserPreferences, updateSupabaseUserPreferences } from "@/services/supabaseUserPreferences";
import { createSupabaseResponse, updateSupabaseResponse, deleteSupabaseResponse,
  getSupabaseOwnerResponse, getSupabaseOwnerResponsesForReviews } from "@/services/supabaseReviewResponses";
import { recordSupabaseRestaurantView, getSupabaseRestaurantViewCount } from "@/services/supabaseRestaurantViews";
jest.mock("@/services/supabase",()=>({supabase:{rpc:jest.fn(),from:jest.fn(),auth:{getUser:jest.fn()}}}));
jest.mock("@/services/supabaseRestaurants",()=>({getSupabaseRestaurantsByIds:jest.fn()}));
jest.mock("@/services/supabaseReviews",()=>({getSupabaseReviewStatsForRestaurants:jest.fn()}));
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase));
// Payload contract tests; actual credential races are covered separately.
jest.mock("@/services/supabasePinnedSession", () => ({
  pinSupabaseSession: async () => ({ userId: "fixture-owner", accessToken: "fixture-token", client: {
    rpc: (...args: unknown[]) => ({ setHeader: () => (supabase.rpc as jest.Mock)(...args) }),
  } }), assertSupabaseSessionCurrent: jest.fn(),
}));
const rpc=supabase.rpc as jest.Mock;
const from=supabase.from as jest.Mock;
const auth=supabase.auth.getUser as jest.Mock;
const hydrate=getSupabaseRestaurantsByIds as jest.Mock;
const stats=getSupabaseReviewStatsForRestaurants as jest.Mock;
const id=(n:number)=>`fc000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const reply={id:id(1),review_id:id(2),restaurant_id:id(3),author_id:id(4),text:"Thanks",created_at:"date",updated_at:"date"};
const collection={id:id(1),owner_id:id(4),title:"Lunch",restaurant_ids:[id(3),id(2),id(5)],is_public:true};
const originalWorker=process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
const originalOtp=process.env.EXPO_PUBLIC_EMAIL_OTP_URL;
beforeEach(()=>{jest.resetAllMocks(); delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL; delete process.env.EXPO_PUBLIC_EMAIL_OTP_URL;});
afterAll(()=>{
  if (originalWorker===undefined) delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL; else process.env.EXPO_PUBLIC_MEDIA_WORKER_URL=originalWorker;
  if (originalOtp===undefined) delete process.env.EXPO_PUBLIC_EMAIL_OTP_URL; else process.env.EXPO_PUBLIC_EMAIL_OTP_URL=originalOtp;
});
test("media paths resolve to Worker URLs; external photos and null stay intact",()=>{
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL="https://media.example.test/";
  expect(getSupabaseImageUrl(`usr/${id(4)}/avatar.jpg`)).toBe(`https://media.example.test/media/usr/${id(4)}/avatar.jpg`);
  expect(getSupabaseImageUrl("https://google.example.test/photo")).toBe("https://google.example.test/photo");
  expect(getSupabaseImageUrl(null)).toBeNull();
});
test("default R2 media origin is independent of the legacy email Worker",()=>{
  process.env.EXPO_PUBLIC_EMAIL_OTP_URL="https://worker.example.test/auth/email-otp";
  expect(getSupabaseImageUrl("usr/avatar.jpg")).toBe("https://hidden-plate-pay.hiddenplate-ja.workers.dev/media/usr/avatar.jpg");
  process.env.EXPO_PUBLIC_EMAIL_OTP_URL="bad";
  expect(getSupabaseImageUrl("usr/avatar.jpg")).toBe("https://hidden-plate-pay.hiddenplate-ja.workers.dev/media/usr/avatar.jpg");
});
test("collection hydration preserves order, drops unavailable restaurants and applies real review stats",async()=>{
  const single=jest.fn().mockResolvedValue({data:collection});
  from.mockReturnValue({select:()=>({eq:()=>({single})})});
  hydrate.mockResolvedValue(new Map([[id(2),{id:id(2),reviewCount:7,averageRating:5}],[id(3),{id:id(3),reviewCount:0,averageRating:0}]]));
  stats.mockResolvedValue(new Map([[id(3),{count:1501,average:4.2}],[id(2),{count:0,average:0}]]));
  const result=await getSupabaseCollectionWithRestaurants(id(1));
  expect(result.restaurants).toEqual([{id:id(3),reviewCount:1501,averageRating:4.2},{id:id(2),reviewCount:0,averageRating:0}]);
  expect(stats).toHaveBeenCalledWith(collection.restaurant_ids);
});
test("empty collections don't request ratings or restaurants",async()=>{
  from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:{...collection,restaurant_ids:[]}})})})});
  expect((await getSupabaseCollectionWithRestaurants(id(1))).restaurants).toEqual([]);
  expect(stats).not.toHaveBeenCalled();expect(hydrate).not.toHaveBeenCalled();
});
test("collection membership accepts composite arrays and rejects malformed results",async()=>{
  rpc.mockResolvedValueOnce({data:[collection]}).mockResolvedValueOnce({data:[]});
  await expect(changeSupabaseCollectionMembership(id(1),id(3),true)).resolves.toMatchObject({restaurantIds:collection.restaurant_ids});
  await expect(changeSupabaseCollectionMembership(id(1),id(3),true)).rejects.toThrow("Couldn't load");
});
test("settings read failures keep existing tolerant defaults",async()=>{
  auth.mockRejectedValue(new Error("Offline"));
  expect(await getSupabaseUserPreferences()).toMatchObject({notificationsEnabled:true,favoriteCuisines:[]});
});
test("settings use atomic patch RPC without downloading or overwriting a full profile",async()=>{
  rpc.mockResolvedValue({data:{notifyOnLike:false,notifyOnFollow:false,favoriteCuisines:["Thai"]}});
  await expect(updateSupabaseUserPreferences({notifyOnLike:false})).resolves.toMatchObject({notifyOnLike:false,notifyOnFollow:false,favoriteCuisines:["Thai"]});
  expect(rpc).toHaveBeenCalledWith("merge_my_preferences",{preference_patch:{notifyOnLike:false}});
  expect(from).not.toHaveBeenCalled();expect(auth).not.toHaveBeenCalled();
});
test("settings write errors and malformed replies stay visible",async()=>{
  rpc.mockResolvedValueOnce({error:{message:"Denied"}}).mockResolvedValueOnce({data:[]});
  await expect(updateSupabaseUserPreferences({})).rejects.toThrow("Denied");
  await expect(updateSupabaseUserPreferences({})).rejects.toThrow("Couldn't load");
});
test("owner reply writes map composite results and never supply an author",async()=>{
  rpc.mockResolvedValue({data:[reply]});
  await expect(createSupabaseResponse({reviewId:id(2),restaurantId:id(3),text:" Thanks "})).resolves.toMatchObject({reviewId:id(2),restaurantId:id(3),authorId:id(4),text:"Thanks"});
  expect(rpc).toHaveBeenLastCalledWith("write_owner_response",{target_review:id(2),target_restaurant:id(3),response_text:"Thanks"});
  await updateSupabaseResponse(id(1),"https://example.test/menu");
  expect(rpc).toHaveBeenLastCalledWith("write_owner_response",{response_id:id(1),response_text:"https://example.test/menu"});
});
test("blank and overlong replies never write; duplicate errors remain friendly",async()=>{
  await expect(createSupabaseResponse({reviewId:id(2),restaurantId:id(3),text:" "})).rejects.toThrow("Write a reply");
  await expect(updateSupabaseResponse(id(1),"x".repeat(1001))).rejects.toThrow("1000");
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({error:{code:"23505",message:"duplicate"}});
  await expect(updateSupabaseResponse(id(1),"Thanks")).rejects.toThrow("already replied");
});
test("reply reads tolerate failures and invalid IDs",async()=>{
  expect(await getSupabaseOwnerResponse("bad",id(4))).toBeNull();
  expect(await getSupabaseOwnerResponsesForReviews([id(2)],null)).toEqual(new Map());
  expect(from).not.toHaveBeenCalled();
  from.mockImplementation(()=>{throw new Error("Offline");});
  expect(await getSupabaseOwnerResponse(id(2),id(4))).toBeNull();
});
test("batch reply reads dedupe and chunk IDs below API caps",async()=>{
  const batch=jest.fn().mockResolvedValue({data:[reply]});
  from.mockReturnValue({select:()=>({eq:()=>({in:batch})})});
  const ids=Array.from({length:205},(_,n)=>id(n+1));
  const result=await getSupabaseOwnerResponsesForReviews([...ids,ids[0],"bad"],id(4));
  expect(batch.mock.calls.map(([,ids])=>ids.length)).toEqual([100,100,5]);
  expect(result.get(id(2))).toMatchObject({id:id(1),authorId:id(4)});
});
test("reply deletion uses checked RPC and surfaces denial",async()=>{
  rpc.mockResolvedValue({error:{message:"Not yours"}});
  await expect(deleteSupabaseResponse(id(1))).rejects.toThrow("Not yours");
  expect(rpc).toHaveBeenCalledWith("delete_owner_response",{response_id:id(1)});
});
test("views are non-blocking, invalid IDs don't request, and counts are numeric",async()=>{
  await recordSupabaseRestaurantView("bad");expect(await getSupabaseRestaurantViewCount("bad")).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockRejectedValueOnce(new Error("Offline"));await recordSupabaseRestaurantView(id(3));
  rpc.mockResolvedValueOnce({data:"2501"}).mockResolvedValueOnce({error:{message:"Denied"}}).mockRejectedValueOnce(new Error("Offline"));
  expect(await getSupabaseRestaurantViewCount(id(3))).toBe(2501);
  expect(await getSupabaseRestaurantViewCount(id(3))).toBe(0);
  expect(await getSupabaseRestaurantViewCount(id(3))).toBe(0);
});
