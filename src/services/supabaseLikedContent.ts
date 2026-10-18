// Like-recency paging lives on the composite-key like row, not content creation.
import {collectSupabaseMemberPage} from "@/services/supabasePagination";
import {SUPABASE_UUID} from "@/services/supabaseAdminQueue";
import {mapSupabaseReview,type SupabaseReviewRow} from "@/services/supabaseReviews";
import {mapSupabasePost,type SupabasePostRow} from "@/services/supabasePosts";
import type {ReviewPage} from "@/types/review";
import type {Post} from "@/types/post";
export interface SupabaseLikedReviewsPage extends ReviewPage {likedAt:Map<string,string>}
export interface SupabaseLikedPostsPage {items:Post[];likedAt:Map<string,string>;hasMore:boolean;nextCursor:string|null}
type LikeRow<T>={id:string;liked_at:string;content:T};
type Options={cursor?:string|null;pageSize?:number};
export async function listSupabaseLikedReviewsByUser(userId:string,options:Options={}):Promise<SupabaseLikedReviewsPage> {
  if (!SUPABASE_UUID.test(userId)) throw new Error("Invalid user ID.");
  const page=await collectSupabaseMemberPage<LikeRow<SupabaseReviewRow>>("liked_content_page",{content_kind:"review",target_user:userId},options.pageSize ?? 20,options.cursor);
  return {...page,items:page.items.map(row=>mapSupabaseReview(row.content)),likedAt:new Map(page.items.map(row=>[row.content.id,row.liked_at]))};
}
export async function listSupabaseLikedPostsByUser(userId:string,options:Options={}):Promise<SupabaseLikedPostsPage> {
  const empty=()=>({items:[],likedAt:new Map<string,string>(),hasMore:false,nextCursor:null});
  if (!SUPABASE_UUID.test(userId)) return empty();
  try {
    const page=await collectSupabaseMemberPage<LikeRow<SupabasePostRow>>("liked_content_page",{content_kind:"post",target_user:userId},options.pageSize ?? 20,options.cursor);
    return {items:page.items.map(row=>mapSupabasePost(row.content)),likedAt:new Map(page.items.map(row=>[row.content.id,row.liked_at])),hasMore:page.hasMore,nextCursor:page.nextCursor};
  } catch {return empty();}
}
