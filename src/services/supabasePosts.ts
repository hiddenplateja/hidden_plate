// Staged community posts; existing screens remain on Appwrite.
import { requireSupabaseDataSession, requestSupabaseRpc, restForSupabaseDataSession } from "@/services/supabaseDataRequest";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { collectSupabaseMemberPage } from "@/services/supabasePagination";
import { containsUrl, URL_REJECTION_MESSAGE } from "@/utils/contentValidation";
import type { CreatePostInput, Post, PostPage } from "@/types/post";
export type SupabasePostRow={id:string;created_at:string;user_id:string|null;text:string;image_paths:string[]|null};
export function mapSupabasePost(row:SupabasePostRow):Post {
  return {id:row.id,createdAt:row.created_at,userId:row.user_id ?? "deleted_user",text:row.text,imageIds:row.image_paths ?? []};
}
export function validateSupabaseCommunityText(text:string,max:number,emptyMessage:string):string {
  const value=text.trim();
  if (!value) throw new Error(emptyMessage);
  if (value.length>max) throw new Error(`Text must be ${max} characters or less.`);
  if (containsUrl(value)) throw new Error(URL_REJECTION_MESSAGE);
  return value;
}
export const supabasePostsEnabled=()=>true;
export async function createSupabasePost(input:CreatePostInput):Promise<Post> {
  const text=validateSupabaseCommunityText(input.text,500,"Write something first.");
  if ((input.imageIds?.length ?? 0)>4) throw new Error("Up to 4 images per post.");
  const {data,error}=await requestSupabaseRpc("create_community_post",{post_text:text,post_images:input.imageIds ?? []});
  if (error) throw new Error(error.message);
  const row=(Array.isArray(data)?data[0]:data) as SupabasePostRow|null;
  if (!row?.id) throw new Error("Couldn't load your post.");
  return mapSupabasePost(row);
}
export async function getSupabasePostById(id:string):Promise<Post|null> {
  if (!SUPABASE_UUID.test(id)) return null;
  try {
    const pinned = await requireSupabaseDataSession();
    const {data,error}=await restForSupabaseDataSession(pinned, client => client.from("posts").select("*").eq("id",id).maybeSingle());
    return error || !data ? null : mapSupabasePost(data as SupabasePostRow);
  } catch {return null;}
}
export async function deleteSupabasePost(id:string):Promise<void> {
  const {error}=await requestSupabaseRpc("delete_community_content",{content_kind:"post",target_id:id});
  if (error) throw new Error(error.message);
}
const empty=():PostPage=>({items:[],total:0,hasMore:false,nextCursor:null});
type Options={pageSize?:number;cursor?:string|null};
async function page(args:Record<string,unknown>,options:Options):Promise<PostPage> {
  const result=await collectSupabaseMemberPage<SupabasePostRow>("community_post_page",args,options.pageSize ?? 30,options.cursor);
  return {...result,items:result.items.map(mapSupabasePost)};
}
export async function listSupabaseLatestPosts(options:Options={}):Promise<PostPage> {
  try {return await page({following_only:false},options);} catch {return empty();}
}
export async function listSupabasePostsByFollowing(followingIds:string[],options:Options={}):Promise<PostPage> {
  if (!followingIds.length) return empty();
  // The database follows the caller's real relationship rows, without an ID cap.
  try {return await page({following_only:true},options);} catch {return empty();}
}
export async function listSupabasePostsByUser(userId:string,options:Options={}):Promise<PostPage> {
  if (!SUPABASE_UUID.test(userId)) return empty();
  return page({target_user:userId,following_only:false},options);
}
