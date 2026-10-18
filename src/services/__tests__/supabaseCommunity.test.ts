import {supabase} from "@/services/supabase";
import {createSupabasePost,deleteSupabasePost,getSupabasePostById,listSupabaseLatestPosts,listSupabasePostsByFollowing,listSupabasePostsByUser} from "@/services/supabasePosts";
import {addSupabaseReviewComment,addSupabasePostComment,deleteSupabaseComment,deleteSupabasePostComment,
  listSupabaseComments,listSupabaseCommentsForPost,getSupabaseCommentById,getSupabasePostCommentById,
  getSupabasePostCounts,getSupabaseLikedReviewIds,getSupabaseLikedPostIds,likeSupabasePost,unlikeSupabasePost,
  likeSupabaseReview,unlikeSupabaseReview,hasSupabaseUserLikedPost} from "@/services/supabaseSocial";
import {listSupabaseNotifications,getSupabaseUnreadCount,markSupabaseNotificationsRead,deleteSupabaseNotification} from "@/services/supabaseNotifications";
jest.mock("@/services/supabase",()=>({supabase:{rpc:jest.fn(),from:jest.fn(),auth:{getUser:jest.fn()}}}));
// These tests check payloads/mapping; real inbox transition tests use real guards.
jest.mock("@/services/supabaseDataRequest", () => ({
  ...jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase, async () => (await supabase.auth.getUser()).data.user?.id),
}));
const rpc=supabase.rpc as jest.Mock;const from=supabase.from as jest.Mock;const user=supabase.auth.getUser as jest.Mock;
const id=(n:number)=>`fd000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const post={id:id(1),created_at:"date",user_id:id(2),text:"Hello",image_paths:["post/photo.jpg"]};
const comment={id:id(4),created_at:"date",user_id:id(2),text:"Nice",review_id:id(1),restaurant_id:id(3)};
const notification={id:id(1),user_id:id(2),actor_id:null,type:"like",title:"New like",body:"Body",created_at:"date",is_read:false,data:{postId:id(3)}};
beforeEach(()=>{jest.resetAllMocks();user.mockResolvedValue({data:{user:{id:id(2)}}});rpc.mockResolvedValue({data:null,error:null});});
test("post creation trims text, maps a composite result and never supplies identity",async()=>{
  rpc.mockResolvedValue({data:[post]});
  await expect(createSupabasePost({text:" Hello ",imageIds:["post/photo.jpg"]})).resolves.toEqual({id:id(1),createdAt:"date",userId:id(2),text:"Hello",imageIds:["post/photo.jpg"]});
  expect(rpc).toHaveBeenCalledWith("create_community_post",{post_text:"Hello",post_images:["post/photo.jpg"]});expect(from).not.toHaveBeenCalled();
});
test.each([" ","x".repeat(501),"Visit example dot com"])("invalid post text never writes: %s",async text=>{
  await expect(createSupabasePost({text})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
});
test("image count, malformed response and post write denial are visible",async()=>{
  await expect(createSupabasePost({text:"Hi",imageIds:Array(5).fill("pic")})).rejects.toThrow("4 images");
  rpc.mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({error:{message:"Denied"}});
  await expect(createSupabasePost({text:"Hi"})).rejects.toThrow("Couldn't load");
  await expect(createSupabasePost({text:"Hi"})).rejects.toThrow("Denied");
});
test("post latest/following pages use lookahead, real server follows and preserve cursor",async()=>{
  rpc.mockResolvedValue({data:{items:[post,{...post,id:id(3)}],total:2}});
  const page=await listSupabaseLatestPosts({pageSize:1});expect(page).toMatchObject({hasMore:true,nextCursor:id(1),total:2});
  await listSupabasePostsByFollowing([id(9)],{pageSize:1,cursor:id(1)});
  expect(rpc).toHaveBeenLastCalledWith("community_post_page",{following_only:true,after_id:id(1),page_size:1});
  const before=rpc.mock.calls.length;expect((await listSupabasePostsByFollowing([])).items).toEqual([]);expect(rpc).toHaveBeenCalledTimes(before);
});
test("secondary feeds tolerate failure; user profile feed surfaces it",async()=>{
  rpc.mockResolvedValue({error:{message:"Offline"}});
  expect((await listSupabaseLatestPosts()).items).toEqual([]);
  expect((await listSupabasePostsByFollowing([id(2)])).items).toEqual([]);
  await expect(listSupabasePostsByUser(id(2))).rejects.toThrow("Offline");
});
test("single-post missing/offline reads are tolerant",async()=>{
  expect(await getSupabasePostById("bad")).toBeNull();expect(from).not.toHaveBeenCalled();
  from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:post})})})});
  expect(await getSupabasePostById(id(1))).toMatchObject({userId:id(2),imageIds:["post/photo.jpg"]});
  from.mockImplementation(()=>{throw new Error("Offline");});expect(await getSupabasePostById(id(1))).toBeNull();
});
test("review comments include real restaurant parent; post comments map camelCase",async()=>{
  rpc.mockResolvedValueOnce({data:comment}).mockResolvedValueOnce({data:{...comment,post_id:id(1)}});
  expect(await addSupabaseReviewComment({reviewId:id(1),restaurantId:id(3),text:" Nice "})).toEqual({id:id(4),createdAt:"date",userId:id(2),text:"Nice",reviewId:id(1),restaurantId:id(3)});
  expect(rpc).toHaveBeenNthCalledWith(1,"write_community_comment",{content_kind:"review",target_id:id(1),target_restaurant:id(3),comment_text:"Nice"});
  expect(await addSupabasePostComment({postId:id(1),text:"Nice"})).toMatchObject({postId:id(1),userId:id(2)});
  expect(user).not.toHaveBeenCalled();
});
test("comment validation and malformed parent responses fail visibly",async()=>{
  await expect(addSupabasePostComment({postId:id(1),text:"name at gmail dot com"})).rejects.toThrow("Links");
  await expect(addSupabasePostComment({postId:id(1),text:"x".repeat(1001)})).rejects.toThrow("1000");
  expect(rpc).not.toHaveBeenCalled();rpc.mockResolvedValue({data:{...comment,restaurant_id:undefined}});
  await expect(addSupabaseReviewComment({reviewId:id(1),restaurantId:id(3),text:"Nice"})).rejects.toThrow("Couldn't load");
});
test("comment pages retain cursor, fields, ascending server contract and final lookahead",async()=>{
  rpc.mockResolvedValueOnce({data:{items:[comment,{...comment,id:id(5)}],total:2}}).mockResolvedValueOnce({data:{items:[{...comment,post_id:id(1)}],total:1}});
  expect(await listSupabaseComments(id(1),{pageSize:1,cursor:id(3)})).toMatchObject({items:[{reviewId:id(1),restaurantId:id(3)}],hasMore:true,nextCursor:id(4)});
  expect(rpc).toHaveBeenNthCalledWith(1,"community_comment_page",{content_kind:"review",target_id:id(1),after_id:id(3),page_size:1});
  expect(await listSupabaseCommentsForPost(id(1),{pageSize:1})).toMatchObject({hasMore:false,items:[{postId:id(1)}]});
});
test("single comment reads hydrate review parents and fail tolerantly",async()=>{
  from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:{...comment,restaurant_id:undefined,reviews:{restaurant_id:id(3)}}})})})});
  expect(await getSupabaseCommentById(id(4))).toMatchObject({restaurantId:id(3)});
  from.mockImplementation(()=>{throw new Error("Offline");});expect(await getSupabasePostCommentById(id(4))).toBeNull();
});
test("like/unlike operations only request trusted identity-bound writes",async()=>{
  await likeSupabaseReview(id(1));await unlikeSupabaseReview(id(1));await likeSupabasePost(id(1));await unlikeSupabasePost(id(1));
  expect(rpc.mock.calls.map(([,args])=>args)).toEqual([
    {content_kind:"review",target_id:id(1),liked:true},{content_kind:"review",target_id:id(1),liked:false},
    {content_kind:"post",target_id:id(1),liked:true},{content_kind:"post",target_id:id(1),liked:false}]);
  expect(from).not.toHaveBeenCalled();expect(user).not.toHaveBeenCalled();
  rpc.mockResolvedValue({error:{message:"Blocked"}});await expect(likeSupabasePost(id(1))).rejects.toThrow("Blocked");
});
test("batch liked IDs dedupe/chunk and decoration failures clear partial data",async()=>{
  const batch=jest.fn().mockImplementation(async(_,ids)=>({data:ids.map((post_id:string)=>({post_id,review_id:post_id}))}));
  from.mockReturnValue({select:()=>({eq:()=>({in:batch})})});
  const ids=Array.from({length:205},(_,n)=>id(n+1));
  expect((await getSupabaseLikedPostIds([...ids,ids[0],"bad"])).size).toBe(205);
  expect(batch.mock.calls.map(([,ids])=>ids.length)).toEqual([100,100,5]);
  batch.mockResolvedValueOnce({data:[{review_id:id(1)}]}).mockResolvedValueOnce({error:{message:"Offline"}});
  expect(await getSupabaseLikedReviewIds(ids)).toEqual(new Set());
});
test("liked checks tolerate signed-out/offline state and invalid IDs",async()=>{
  expect(await hasSupabaseUserLikedPost("bad")).toBe(false);expect(from).not.toHaveBeenCalled();
  user.mockResolvedValue({data:{user:null}});expect(await hasSupabaseUserLikedPost(id(1))).toBe(false);
});
test("counts aggregate server-side in 100-ID batches, never download likes/comments",async()=>{
  rpc.mockImplementation(async(_,args)=>({data:args.target_ids.map((post_id:string)=>({post_id,likes:"1501",comments:"2001"}))}));
  const ids=Array.from({length:205},(_,n)=>id(n+1));const result=await getSupabasePostCounts([...ids,ids[0],"bad"]);
  expect(result.get(id(1))).toEqual({likes:1501,comments:2001});expect(rpc.mock.calls.map(([,args])=>args.target_ids.length)).toEqual([100,100,5]);
  expect(from).not.toHaveBeenCalled();rpc.mockRejectedValue(new Error("Offline"));expect(await getSupabasePostCounts(ids)).toEqual(new Map());
});
test("post/comment deletions surface denial through trusted RPCs",async()=>{
  await deleteSupabasePost(id(1));await deleteSupabaseComment(id(4));await deleteSupabasePostComment(id(5));
  expect(rpc.mock.calls.map(([,args])=>args.content_kind)).toEqual(["post","review_comment","post_comment"]);
  rpc.mockResolvedValue({error:{message:"Not yours"}});await expect(deleteSupabaseComment(id(4))).rejects.toThrow("Not yours");
});
test("inbox pages preserve cursor, derive user server-side, and map data safely",async()=>{
  rpc.mockResolvedValue({data:{items:[notification,{...notification,id:id(3)}],total:2}});
  expect(await listSupabaseNotifications({pageSize:1,cursor:id(4)})).toMatchObject({hasMore:true,nextCursor:id(1),items:[{actorId:"",isRead:false,data:{postId:id(3)}}]});
  expect(rpc).toHaveBeenCalledWith("my_notification_page",{after_id:id(4),page_size:1});
  rpc.mockResolvedValue({data:{items:[{...notification,data:["bad"]}],total:1}});
  expect((await listSupabaseNotifications()).items[0].data).toEqual({});
});
test("inbox request clamps page size; signed-out/auth failures don't query",async()=>{
  rpc.mockResolvedValue({data:{items:[],total:0}});await listSupabaseNotifications({pageSize:1000});
  expect(rpc.mock.calls[0][1].page_size).toBe(100);rpc.mockClear();
  user.mockRejectedValue(new Error("Offline"));expect((await listSupabaseNotifications()).items).toEqual([]);expect(rpc).not.toHaveBeenCalled();
});
test("unread counts aren't capped downloads and failures remain tolerant",async()=>{
  rpc.mockResolvedValueOnce({data:"1501"}).mockResolvedValueOnce({error:{message:"Offline"}}).mockRejectedValueOnce(new Error("Offline"));
  expect(await getSupabaseUnreadCount()).toBe(1501);expect(await getSupabaseUnreadCount()).toBe(0);expect(await getSupabaseUnreadCount()).toBe(0);
  expect(from).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith("my_unread_notification_count");
});
test("notification read/delete writes stay recipient scoped and only mark is_read",async()=>{
  const setHeader=jest.fn().mockResolvedValue({error:null});
  const eq=jest.fn().mockReturnThis();eq.mockImplementation(()=>({eq,setHeader}));
  const update=jest.fn(()=>({eq}));const remove=jest.fn(()=>({eq}));from.mockReturnValue({update,delete:remove});
  await markSupabaseNotificationsRead(id(1));await deleteSupabaseNotification(id(1));
  expect(update).toHaveBeenCalledWith({is_read:true});expect(eq).toHaveBeenCalledWith("user_id",id(2));expect(eq).toHaveBeenCalledWith("id",id(1));
});
