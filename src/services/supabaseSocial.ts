// Staged contracts: Postgres derives identity, parents, counters and notifications.
import { requireSupabaseDataSession, requestSupabaseRpc, restForSupabaseDataSession, rpcForSupabaseDataSession } from "@/services/supabaseDataRequest";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { collectSupabaseMemberPage } from "@/services/supabasePagination";
import { validateSupabaseCommunityText } from "@/services/supabasePosts";
import type { CommentPage, CreateCommentInput, ReviewComment } from "@/types/reviewComment";
import type { CreatePostCommentInput, PostComment, PostCommentPage } from "@/types/post";
type Kind="post"|"review";
type Row={id:string;created_at:string;user_id:string|null;text:string;review_id?:string;restaurant_id?:string;post_id?:string;reviews?:{restaurant_id:string}};
function mapReviewComment(row:Row):ReviewComment {
  const restaurantId=row.restaurant_id ?? row.reviews?.restaurant_id;
  if (!row.id || !row.review_id || !restaurantId) throw new Error("Couldn't load your comment.");
  return {id:row.id,createdAt:row.created_at,userId:row.user_id ?? "deleted_user",text:row.text,reviewId:row.review_id,restaurantId};
}
function mapPostComment(row:Row):PostComment {
  if (!row.id || !row.post_id) throw new Error("Couldn't load your comment.");
  return {id:row.id,createdAt:row.created_at,userId:row.user_id ?? "deleted_user",text:row.text,postId:row.post_id};
}
async function setLike(kind:Kind,id:string,liked:boolean):Promise<void> {
  const {error}=await requestSupabaseRpc("set_community_like",{content_kind:kind,target_id:id,liked});
  if (error) throw new Error(error.message);
}
// The legacy restaurant argument is accepted, but never trusted as the parent.
export const likeSupabaseReview=(id:string,_restaurantId?:string)=>setLike("review",id,true);
export const unlikeSupabaseReview=(id:string)=>setLike("review",id,false);
export const likeSupabasePost=(id:string)=>setLike("post",id,true);
export const unlikeSupabasePost=(id:string)=>setLike("post",id,false);
function validIds(ids:string[]):string[] {return [...new Set(ids.filter(id=>SUPABASE_UUID.test(id)))];}
async function likedIds(kind:Kind,ids:string[]):Promise<Set<string>> {
  const unique=validIds(ids);const result=new Set<string>(); if (!unique.length)return result;
  try {
    const pinned = await requireSupabaseDataSession();
    for(let start=0;start<unique.length;start+=100){
      const column=`${kind}_id`;
      const {data,error}=await restForSupabaseDataSession(pinned, client => client.from(`${kind}_likes`).select(column).eq("user_id",pinned.userId).in(column,unique.slice(start,start+100)));
      if(error)return new Set();
      for(const row of data ?? [])result.add((row as unknown as Record<string,string>)[column]);
    }return result;
  }catch{return new Set();}
}
export const getSupabaseLikedReviewIds=(ids:string[])=>likedIds("review",ids);
export const getSupabaseLikedPostIds=(ids:string[])=>likedIds("post",ids);
async function hasLiked(kind:Kind,id:string,userId?:string):Promise<boolean>{
  if(!SUPABASE_UUID.test(id))return false;
  try{
    const pinned = await requireSupabaseDataSession();
    const uid=userId ?? pinned.userId;
    if(!uid || !SUPABASE_UUID.test(uid))return false;
    const {data,error}=await restForSupabaseDataSession(pinned, client => client.from(`${kind}_likes`).select(`${kind}_id`).eq("user_id",uid).eq(`${kind}_id`,id).limit(1));
    return !error && !!data?.length;
  }catch{return false;}
}
export const hasSupabaseUserLikedReview=(id:string,userId?:string)=>hasLiked("review",id,userId);
export const hasSupabaseUserLikedPost=(id:string,userId?:string)=>hasLiked("post",id,userId);
async function addComment(kind:Kind,targetId:string,text:string,restaurantId?:string):Promise<Row>{
  const body=validateSupabaseCommunityText(text,1000,"Comment can't be empty.");
  const {data,error}=await requestSupabaseRpc("write_community_comment",{content_kind:kind,target_id:targetId,comment_text:body,...(restaurantId ? {target_restaurant:restaurantId}: {})});
  if(error)throw new Error(error.message);
  if(!data?.id)throw new Error("Couldn't load your comment.");
  return data as Row;
}
export async function addSupabaseReviewComment(input:CreateCommentInput):Promise<ReviewComment>{
  return mapReviewComment(await addComment("review",input.reviewId,input.text,input.restaurantId));
}
export async function addSupabaseComment(reviewId:string,text:string):Promise<ReviewComment>{
  return mapReviewComment(await addComment("review",reviewId,text));
}
export async function addSupabasePostComment(input:CreatePostCommentInput):Promise<PostComment>{
  return mapPostComment(await addComment("post",input.postId,input.text));
}
type Options={cursor?:string|null;pageSize?:number};
export async function listSupabaseComments(reviewId:string,options:Options={}):Promise<CommentPage>{
  const page=await collectSupabaseMemberPage<Row>("community_comment_page",{content_kind:"review",target_id:reviewId},options.pageSize ?? 30,options.cursor);
  return {...page,items:page.items.map(mapReviewComment)};
}
export async function listSupabaseCommentsForPost(postId:string,options:Options={}):Promise<PostCommentPage>{
  const page=await collectSupabaseMemberPage<Row>("community_comment_page",{content_kind:"post",target_id:postId},options.pageSize ?? 30,options.cursor);
  return {...page,items:page.items.map(mapPostComment)};
}
async function getComment(kind:Kind,id:string):Promise<Row|null>{
  if(!SUPABASE_UUID.test(id))return null;
  try{
    const pinned = await requireSupabaseDataSession();
    const {data,error}=await restForSupabaseDataSession(pinned, client => client.from(`${kind}_comments`).select(kind==="review" ? "*,reviews!inner(restaurant_id)":"*").eq("id",id).maybeSingle());
    return error || !data ? null : data as unknown as Row;
  }catch{return null;}
}
export async function getSupabaseCommentById(id:string):Promise<ReviewComment|null>{
  try{const row=await getComment("review",id);return row ? mapReviewComment(row):null;}catch{return null;}
}
export async function getSupabasePostCommentById(id:string):Promise<PostComment|null>{
  try{const row=await getComment("post",id);return row ? mapPostComment(row):null;}catch{return null;}
}
async function remove(kind:string,id:string):Promise<void>{
  const {error}=await requestSupabaseRpc("delete_community_content",{content_kind:kind,target_id:id});
  if(error)throw new Error(error.message);
}
// Review counters are recomputed by the existing database trigger.
export const deleteSupabaseComment=(id:string,_reviewId?:string)=>remove("review_comment",id);
export const deleteSupabasePostComment=(id:string)=>remove("post_comment",id);
export async function getSupabasePostCounts(ids:string[]):Promise<Map<string,{likes:number;comments:number}>>{
  const unique=validIds(ids);const result=new Map<string,{likes:number;comments:number}>();
  if (!unique.length) return result;
  try{
    const pinned = await requireSupabaseDataSession();
    for(let start=0;start<unique.length;start+=100){
      const {data,error}=await rpcForSupabaseDataSession(pinned,"community_post_counts",{target_ids:unique.slice(start,start+100)});
      if(error)return new Map();
      for(const row of data ?? [])result.set(row.post_id,{likes:Number(row.likes),comments:Number(row.comments)});
    }return result;
  }catch{return new Map();}
}
export async function getSupabasePostLikeCounts(ids:string[]):Promise<Map<string,number>>{
  return new Map([...(await getSupabasePostCounts(ids))].map(([id,value])=>[id,value.likes]));
}
export async function getSupabasePostCommentCounts(ids:string[]):Promise<Map<string,number>>{
  return new Map([...(await getSupabasePostCounts(ids))].map(([id,value])=>[id,value.comments]));
}
export async function getSupabasePostLikeCount(id:string):Promise<number>{return (await getSupabasePostLikeCounts([id])).get(id) ?? 0;}
