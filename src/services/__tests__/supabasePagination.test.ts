import { supabase } from "@/services/supabase";
import { collectSupabasePage } from "@/services/supabasePagination";
import { listSupabaseRestaurants, searchSupabaseRestaurants } from "@/services/supabaseRestaurants";
import { createSupabaseReview, getSupabaseRestaurantRatingDistribution, getSupabaseReviewStatsForRestaurants,
  listSupabaseReviewsForRestaurant } from "@/services/supabaseReviews";
jest.mock("@/services/supabase",() => ({ supabase:{ rpc:jest.fn() } }));
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase));
const rpc=supabase.rpc as jest.Mock;
const id=(n:number)=>`fa100000-0000-4000-8000-${String(n).padStart(12,"0")}`;
beforeEach(()=>rpc.mockReset());

test("search preserves the existing 50-result bound and ignores an empty term", async () => {
  expect(await searchSupabaseRestaurants("   ")).toEqual([]); expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: { items: [], total: 0 }, error: null });
  expect(await searchSupabaseRestaurants("  SEAFOOD ")).toEqual([]);
  expect(rpc.mock.calls[0]).toEqual(["restaurant_page", { filters: { search: "seafood" }, sort_by: "rating", exclude_expired: false, after_id: null, page_size: 50 }]);
});
test("injected pinned page requester never falls back to the shared auth client", async () => {
  const pinned = jest.fn(async () => ({ data: { items: [{ id: id(1) }], total: 1 }, error: null }));
  expect((await collectSupabasePage("private_page", {}, 20, undefined, pinned)).items).toEqual([{ id: id(1) }]);
  expect(pinned).toHaveBeenCalledWith("private_page", { after_id: null, page_size: 20 }); expect(rpc).not.toHaveBeenCalled();
});

test("2000 map rows use eight bounded pages and preserve lookahead/cursor",async()=>{
  const all=Array.from({length:2001},(_,n)=>({id:id(n+1)}));
  rpc.mockImplementation(async(_,args)=>{
    const start=args.after_id ? all.findIndex(row=>row.id===args.after_id)+1 : 0;
    return {data:{items:all.slice(start,start+args.page_size+1),total:2001},error:null};
  });
  const result=await collectSupabasePage("restaurant_page",{sort_by:"rating"},2000);
  expect(result.items).toEqual(all.slice(0,2000));
  expect(result).toMatchObject({total:2001,hasMore:true,nextCursor:id(2000)});
  expect(rpc).toHaveBeenCalledTimes(8);
  expect(rpc.mock.calls.every(([,args])=>args.page_size===250)).toBe(true);
  expect(rpc.mock.calls[1][1].after_id).toBe(id(250));
});
test("end of list and partial second batch stop cleanly",async()=>{
  rpc.mockResolvedValueOnce({data:{items:Array.from({length:251},(_,n)=>({id:id(n+1)})),total:260}})
    .mockResolvedValueOnce({data:{items:Array.from({length:10},(_,n)=>({id:id(n+251)})),total:260}});
  const result=await collectSupabasePage("page",{},300);
  expect(result.items).toHaveLength(260); expect(result.hasMore).toBe(false);
  expect(rpc.mock.calls[1][1].page_size).toBe(50);
});
test("invalid cursor fails before calling backend",async()=>{
  await expect(collectSupabasePage("page",{},25,"bad")).rejects.toThrow("Invalid cursor"); expect(rpc).not.toHaveBeenCalled();
});
test("bad response, backend error and non-progressing cursor fail visibly",async()=>{
  rpc.mockResolvedValueOnce({data:{items:[]}});
  await expect(collectSupabasePage("page",{},25)).rejects.toThrow("Couldn't load");
  rpc.mockResolvedValueOnce({error:{message:"Denied"}});
  await expect(collectSupabasePage("page",{},25)).rejects.toThrow("Denied");
  rpc.mockResolvedValueOnce({data:{items:[{id:id(1)},{id:id(2)}],total:2}});
  await expect(collectSupabasePage("page",{},1,id(1))).rejects.toThrow("Couldn't continue");
});
test("restaurant sort/filters retain contracts and ignore unexpected JS fields",async()=>{
  rpc.mockResolvedValue({data:{items:[],total:0}});
  await listSupabaseRestaurants({sort:"name",cursor:id(1),filters:{search:"literal%",featured:false,ownerId:"forged"} as never});
  expect(rpc).toHaveBeenCalledWith("restaurant_page",{filters:{search:"literal%",featured:false},sort_by:"name",after_id:id(1),page_size:25,exclude_expired:false});
});
test("review paging and composite write result map fields",async()=>{
  const row={id:id(1),restaurant_id:id(2),user_id:id(3),rating:4,comment:"Good",image_paths:[],created_at:"date",updated_at:"date"};
  rpc.mockResolvedValueOnce({data:{items:[row],total:1}});
  const page=await listSupabaseReviewsForRestaurant(id(2),{sort:"popular"});
  expect(rpc.mock.calls[0][1].sort_by).toBe("popular"); expect(page.items[0]).toMatchObject({restaurantId:id(2),rating:4,likeCount:0});
  rpc.mockResolvedValueOnce({data:[row]});
  await expect(createSupabaseReview({restaurantId:id(2),rating:4})).resolves.toMatchObject({id:id(1),restaurantId:id(2)});
});
test("rating distribution is aggregated server-side, not a capped review download",async()=>{
  const result={count:2501,average:4.5,buckets:{1:0,2:0,3:0,4:1250,5:1251}};
  rpc.mockResolvedValue({data:result});
  expect(await getSupabaseRestaurantRatingDistribution(id(1))).toEqual(result);
  expect(rpc).toHaveBeenCalledWith("restaurant_rating_distribution",{target_restaurant:id(1)});
});
test("collection ratings chunk 100 IDs, deduplicate, and exclude invalid IDs",async()=>{
  rpc.mockImplementation(async(_,args)=>({data:args.target_ids.map((restaurant_id:string)=>({restaurant_id,count:"1001",average:"4.2"}))}));
  const ids=Array.from({length:201},(_,n)=>id(n+1));
  const result=await getSupabaseReviewStatsForRestaurants([...ids,ids[0],"bad"]);
  expect(result.size).toBe(201); expect(result.get(ids[0])).toEqual({count:1001,average:4.2});
  expect(rpc.mock.calls.map(([,args])=>args.target_ids.length)).toEqual([100,100,1]);
});
