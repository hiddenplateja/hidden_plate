import {supabase} from "@/services/supabase";
import {listSupabaseLatestReviews,listSupabaseReviewsByFollowing,listSupabaseReviewsByUser,
  getSupabaseReviewById,getMySupabaseReviewForRestaurant,getSupabaseUserReviewStats} from "@/services/supabaseReviews";
import {listSupabaseLikedReviewsByUser,listSupabaseLikedPostsByUser} from "@/services/supabaseLikedContent";
import {listSupabaseFollowers,listSupabaseFollowing,getSupabaseFollowingIds,getSupabaseFollowerIds,
  getSupabaseFollowCounts,followSupabaseUser,unfollowSupabaseUser,setSupabaseFollowing,
  getSupabaseFollowingSetForUsers,isSupabaseFollowing} from "@/services/supabaseRelationships";
jest.mock("@/services/supabase",()=>({supabase:{rpc:jest.fn(),from:jest.fn(),auth:{getUser:jest.fn()}}}));
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase, async () => (await supabase.auth.getUser()).data.user?.id));
const rpc=supabase.rpc as jest.Mock;const from=supabase.from as jest.Mock;const auth=supabase.auth.getUser as jest.Mock;
const id=(n:number)=>`fe000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const review={id:id(1),created_at:"posted",updated_at:"edited",restaurant_id:id(2),user_id:id(3),rating:5,comment:"Nice",image_paths:["review/photo.jpg"],like_count:3,comment_count:4,is_edited:true,is_hidden:false};
const post={id:id(4),created_at:"posted",user_id:id(3),text:"Post",image_paths:[]};
const profile={id:id(3),created_at:"joined",username:"person",display_name:"Person",avatar_path:null,bio:"Bio",is_banned:false};
beforeEach(()=>{jest.resetAllMocks();auth.mockResolvedValue({data:{user:{id:id(9)}}});rpc.mockResolvedValue({data:{items:[],total:0}});});
test("review latest/profile feeds preserve fields and use stable cursor arguments",async()=>{
  rpc.mockResolvedValue({data:{items:[review,{...review,id:id(5)}],total:2}});
  const page=await listSupabaseLatestReviews({pageSize:1,cursor:id(8)});
  expect(page).toMatchObject({total:2,hasMore:true,nextCursor:id(1),items:[{createdAt:"posted",updatedAt:"edited",restaurantId:id(2),userId:id(3),imageIds:["review/photo.jpg"],likeCount:3,commentCount:4,isEdited:true}]});
  expect(rpc).toHaveBeenLastCalledWith("community_review_page",{following_only:false,after_id:id(8),page_size:1});
  await listSupabaseReviewsByUser(id(3));expect(rpc.mock.calls.at(-1)[1]).toMatchObject({target_user:id(3),following_only:false});
});
test("following uses the full caller graph, not a passed/capped author array",async()=>{
  await listSupabaseReviewsByFollowing([id(999)]);expect(rpc).toHaveBeenCalledWith("community_review_page",{following_only:true,after_id:null,page_size:20});
  rpc.mockClear();expect((await listSupabaseReviewsByFollowing([])).items).toEqual([]);expect(rpc).not.toHaveBeenCalled();
});
test("review feeds surface failures and reject malformed cursors/IDs",async()=>{
  rpc.mockResolvedValue({error:{message:"Offline"}});
  await expect(listSupabaseLatestReviews()).rejects.toThrow("Offline");
  await expect(listSupabaseReviewsByFollowing([id(1)])).rejects.toThrow("Offline");
  await expect(listSupabaseReviewsByUser(id(1))).rejects.toThrow("Offline");
  rpc.mockClear();await expect(listSupabaseLatestReviews({cursor:"bad"})).rejects.toThrow("Invalid cursor");
  await expect(listSupabaseReviewsByUser("bad")).rejects.toThrow("Invalid user");expect(rpc).not.toHaveBeenCalled();
});
test("review detail and own-restaurant review use distinct server visibility paths",async()=>{
  rpc.mockResolvedValueOnce({data:review}).mockResolvedValueOnce({data:{...review,is_hidden:true}});
  expect(await getSupabaseReviewById(id(1))).toMatchObject({id:id(1),isHidden:false});
  expect(await getMySupabaseReviewForRestaurant(id(2))).toMatchObject({isHidden:true});
  expect(rpc.mock.calls).toEqual([["community_review_detail",{target_review:id(1)}],["my_restaurant_review",{target_restaurant:id(2)}]]);
  expect(from).not.toHaveBeenCalled();expect(auth).not.toHaveBeenCalled();
});
test("single reviews tolerate missing/offline/malformed IDs",async()=>{
  rpc.mockResolvedValueOnce({data:null}).mockRejectedValueOnce(new Error("Offline"));
  expect(await getSupabaseReviewById(id(1))).toBeNull();expect(await getMySupabaseReviewForRestaurant(id(2))).toBeNull();
  rpc.mockClear();expect(await getSupabaseReviewById("bad")).toBeNull();expect(rpc).not.toHaveBeenCalled();
});
test("review/parish stats are full SQL aggregates with profile field names",async()=>{
  const stats={reviewCount:1101,averageRating:4.7,parishesVisited:14};rpc.mockResolvedValue({data:stats});
  expect(await getSupabaseUserReviewStats(id(3))).toEqual(stats);expect(rpc).toHaveBeenCalledWith("user_review_statistics",{target_user:id(3)});expect(from).not.toHaveBeenCalled();
  rpc.mockRejectedValue(new Error("Offline"));expect(await getSupabaseUserReviewStats(id(3))).toEqual({reviewCount:0,averageRating:0,parishesVisited:0});
});
test("liked-review and post pages map like timestamps without reordering by creation",async()=>{
  rpc.mockResolvedValueOnce({data:{items:[{id:id(1),liked_at:"liked-review",content:review},{id:id(5),liked_at:"older",content:{...review,id:id(5)}}],total:2}})
    .mockResolvedValueOnce({data:{items:[{id:id(4),liked_at:"liked-post",content:post}],total:1}});
  const reviews=await listSupabaseLikedReviewsByUser(id(9),{pageSize:1});expect(reviews).toMatchObject({hasMore:true,nextCursor:id(1),total:2});expect(reviews.likedAt.get(id(1))).toBe("liked-review");expect(reviews.items[0].createdAt).toBe("posted");
  const posts=await listSupabaseLikedPostsByUser(id(9),{cursor:id(8)});expect(posts).toMatchObject({hasMore:false,nextCursor:id(4),items:[{id:id(4),text:"Post"}]});expect(posts.likedAt.get(id(4))).toBe("liked-post");
  expect(rpc.mock.calls[1][1]).toEqual({content_kind:"post",target_user:id(9),after_id:id(8),page_size:20});
});
test("liked reviews throw; secondary liked posts remain tolerant",async()=>{
  rpc.mockResolvedValue({error:{message:"Offline"}});
  await expect(listSupabaseLikedReviewsByUser(id(9))).rejects.toThrow("Offline");expect((await listSupabaseLikedPostsByUser(id(9))).items).toEqual([]);
  rpc.mockClear();await expect(listSupabaseLikedReviewsByUser("bad")).rejects.toThrow("Invalid user");expect((await listSupabaseLikedPostsByUser("bad")).items).toEqual([]);expect(rpc).not.toHaveBeenCalled();
});
test("liked-content requests above 250 collect pages on composite content cursors",async()=>{
  const rows=Array.from({length:301},(_,n)=>({id:id(n+100),liked_at:"time",content:{...review,id:id(n+100)}}));
  rpc.mockImplementation(async(_,args)=>({data:{items:rows.slice(args.after_id ? 250 : 0,(args.after_id ? 250 : 0)+args.page_size+1),total:301}}));
  const page=await listSupabaseLikedReviewsByUser(id(9),{pageSize:300});expect(page.items).toHaveLength(300);expect(page.hasMore).toBe(true);expect(rpc.mock.calls[1][1]).toMatchObject({after_id:id(349),page_size:50});
});
test("follow lists hydrate only public profile columns and preserve relationship order",async()=>{
  rpc.mockResolvedValue({data:{items:[{id:id(3),created_at:"followed",profile},{id:id(4),created_at:"older",profile:{...profile,id:id(4)}}],total:2}});
  const page=await listSupabaseFollowers(id(9),{pageSize:1,cursor:id(8)});expect(page).toMatchObject({hasMore:true,nextCursor:id(3),items:[{id:id(3),email:"",displayName:"Person",bio:"Bio",avatarUrl:null}]});
  expect(rpc.mock.calls[0][1]).toEqual({target_user:id(9),direction:"followers",after_id:id(8),page_size:1});
  await listSupabaseFollowing(id(9));expect(rpc.mock.calls.at(-1)[1].direction).toBe("following");
});
test("follow IDs collect bounded pages instead of an API-capped select",async()=>{
  const rows=Array.from({length:1101},(_,n)=>({id:id(n+100),created_at:"time",profile}));
  rpc.mockImplementation(async(_,args)=>{const start=args.after_id ? rows.findIndex(r=>r.id===args.after_id)+1 : 0;return {data:{items:rows.slice(start,start+args.page_size+1),total:1101}};});
  expect(await getSupabaseFollowingIds(id(9),1101)).toHaveLength(1101);expect(rpc).toHaveBeenCalledTimes(5);
  rpc.mockClear();expect(await getSupabaseFollowerIds(id(9),1)).toEqual([id(100)]);expect(rpc.mock.calls[0][1].direction).toBe("followers");
});
test("follow counts match existing profile field names and avoid capped downloads",async()=>{
  rpc.mockResolvedValue({data:{followerCount:2101,followingCount:1002}});expect(await getSupabaseFollowCounts(id(9))).toEqual({followerCount:2101,followingCount:1002});expect(from).not.toHaveBeenCalled();
});
test("follow reads and decorative statistics retain tolerant fallback",async()=>{
  rpc.mockRejectedValue(new Error("Offline"));expect(await listSupabaseFollowers(id(9))).toEqual({items:[],hasMore:false,nextCursor:null});expect(await getSupabaseFollowingIds(id(9))).toEqual([]);expect(await getSupabaseFollowCounts(id(9))).toEqual({followerCount:0,followingCount:0});
});
test("follow mutations derive identity in SQL and do not duplicate notifications",async()=>{
  rpc.mockResolvedValue({data:id(3)});expect(await followSupabaseUser(id(3))).toBe(id(3));await unfollowSupabaseUser(id(3));await setSupabaseFollowing(id(3),true);
  expect(rpc.mock.calls.map(([,args])=>args)).toEqual([{target_user:id(3),following:true},{target_user:id(3),following:false},{target_user:id(3),following:true}]);expect(from).not.toHaveBeenCalled();expect(auth).not.toHaveBeenCalled();
});
test("follow mutation denials and invalid responses are visible",async()=>{
  rpc.mockResolvedValueOnce({error:{message:"Unavailable"}}).mockResolvedValueOnce({data:id(4)});
  await expect(followSupabaseUser(id(3))).rejects.toThrow("Unavailable");await expect(followSupabaseUser(id(3))).rejects.toThrow("Couldn't update");
  rpc.mockClear();await expect(followSupabaseUser("bad")).rejects.toThrow("Invalid follow");expect(rpc).not.toHaveBeenCalled();
});
test("following decoration chunks/deduplicates IDs and fails closed on partial error",async()=>{
  const ids=Array.from({length:205},(_,n)=>id(n+100));let calls=0;
  from.mockImplementation(()=>({select:()=>({eq:()=>({in:async(_:string,batch:string[])=>{calls++;return {data:batch.map(following_id=>({following_id}))};}})})}));
  expect((await getSupabaseFollowingSetForUsers([...ids,ids[0],"bad"])).size).toBe(205);expect(calls).toBe(3);expect(await isSupabaseFollowing(id(100))).toBe(true);
  from.mockImplementation(()=>({select:()=>({eq:()=>({in:async()=>({error:{message:"Offline"}})})})}));expect((await getSupabaseFollowingSetForUsers(ids)).size).toBe(0);
});
