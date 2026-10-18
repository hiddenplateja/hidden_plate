// Staged owner replies. Postgres independently checks the actual current owner.
import { supabase } from "@/services/supabase";
import { requestSupabaseRpc } from "@/services/supabaseDataRequest";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import type { ReviewResponse } from "@/services/reviewResponses";
type Row={id:string;review_id:string;restaurant_id:string;author_id:string;text:string;created_at:string;updated_at:string};
export class SupabaseResponseError extends Error {
  constructor(message:string) { super(message); this.name="SupabaseResponseError"; }
}
function map(row:Row):ReviewResponse {
  return {id:row.id,reviewId:row.review_id,restaurantId:row.restaurant_id,authorId:row.author_id,text:row.text,createdAt:row.created_at,updatedAt:row.updated_at};
}
function body(text:string):string {
  const value=text.trim();
  if (!value) throw new SupabaseResponseError("Write a reply first.");
  if (value.length>1000) throw new SupabaseResponseError("Replies are limited to 1000 characters.");
  return value;
}
async function write(args:Record<string,unknown>):Promise<ReviewResponse> {
  const {data,error}=await requestSupabaseRpc("write_owner_response",args);
  if (error) throw new SupabaseResponseError(error.code==="23505" ? "You've already replied to this review." : error.message);
  const row=(Array.isArray(data) ? data[0] : data) as Row|null;
  if (!row?.id) throw new SupabaseResponseError("Couldn't load your reply.");
  return map(row);
}
export async function getSupabaseOwnerResponse(reviewId:string,ownerId:string|null):Promise<ReviewResponse|null> {
  if (!ownerId || !SUPABASE_UUID.test(ownerId) || !SUPABASE_UUID.test(reviewId)) return null;
  try {
    const {data,error}=await supabase.from("review_responses").select("*").eq("review_id",reviewId).eq("author_id",ownerId).maybeSingle();
    return error || !data ? null : map(data as Row);
  } catch { return null; }
}
export async function getSupabaseOwnerResponsesForReviews(reviewIds:string[],ownerId:string|null):Promise<Map<string,ReviewResponse>> {
  if (!ownerId || !SUPABASE_UUID.test(ownerId)) return new Map();
  const ids=[...new Set(reviewIds.filter(id=>SUPABASE_UUID.test(id)))]; const result=new Map<string,ReviewResponse>();
  try {
    for (let start=0;start<ids.length;start+=100) {
      const {data,error}=await supabase.from("review_responses").select("*").eq("author_id",ownerId).in("review_id",ids.slice(start,start+100));
      if (error) return new Map();
      for (const row of (data as Row[] | null) ?? []) result.set(row.review_id,map(row));
    }
    return result;
  } catch { return new Map(); }
}
export async function createSupabaseResponse(input:{reviewId:string;restaurantId:string;text:string}):Promise<ReviewResponse> {
  return write({target_review:input.reviewId,target_restaurant:input.restaurantId,response_text:body(input.text)});
}
export async function updateSupabaseResponse(id:string,text:string):Promise<ReviewResponse> {
  return write({response_id:id,response_text:body(text)});
}
export async function deleteSupabaseResponse(id:string):Promise<void> {
  const {error}=await requestSupabaseRpc("delete_owner_response",{response_id:id});
  if (error) throw new SupabaseResponseError(error.message);
}
