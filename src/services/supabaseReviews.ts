// Staged Supabase review adapter; UI remains on Appwrite until cutover.

import { supabase } from "@/services/supabase";
import { assertSupabaseDataSession, requireSupabaseDataSession, requestSupabaseRpc } from "@/services/supabaseDataRequest";
import { collectSupabasePage, collectSupabaseMemberPage } from "@/services/supabasePagination";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import type {
  CreateReviewInput,
  UpdateReviewInput,
  RatingDistribution,
  RatingValue,
  Review,
  ReviewPage,
} from "@/types/review";

export type SupabaseReviewRow = {
  id: string;
  created_at: string;
  updated_at: string;
  restaurant_id: string;
  user_id: string | null;
  rating: number;
  comment: string | null;
  image_paths: string[] | null;
  like_count: number | null;
  comment_count: number | null;
  is_edited: boolean | null;
  is_hidden: boolean | null;
};

const PAGE_SIZE = 20;
function mapWriteResult(data:unknown):Review {
  const row=(Array.isArray(data) ? data[0] : data) as SupabaseReviewRow|null;
  if (!row?.id) throw new Error("Couldn't load your review.");
  return mapSupabaseReview(row);
}

export async function createSupabaseReview(input: CreateReviewInput): Promise<Review> {
  const { data, error } = await requestSupabaseRpc("write_review", {
    payload: { restaurant_id: input.restaurantId, rating: input.rating,
      comment: input.comment ?? null, image_paths: input.imageIds ?? [] },
  });
  if (error) throw new Error(error.code === "23505" ? "You've already reviewed this restaurant." : error.message);
  return mapWriteResult(data);
}

export async function updateSupabaseReview(id: string, patch: UpdateReviewInput): Promise<Review> {
  const payload: Record<string, unknown> = {};
  if (patch.rating !== undefined) payload.rating = patch.rating;
  if (patch.comment !== undefined) payload.comment = patch.comment;
  if (patch.imageIds !== undefined) payload.image_paths = patch.imageIds;
  const { data, error } = await requestSupabaseRpc("write_review", { payload, review_id: id });
  if (error) throw new Error(error.message);
  return mapWriteResult(data);
}

export async function deleteSupabaseReview(id: string): Promise<void> {
  const pinned = await requireSupabaseDataSession();
  await assertSupabaseDataSession(pinned);
  const { data, error } = await pinned.client.from("reviews").delete().eq("id", id).select("id")
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseDataSession(pinned);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Review not found or permission denied.");
}

export function mapSupabaseReview(row: SupabaseReviewRow): Review {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    restaurantId: row.restaurant_id,
    userId: row.user_id ?? "deleted_user",
    rating: row.rating,
    comment: row.comment,
    imageIds: Array.isArray(row.image_paths) ? row.image_paths : [],
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    isEdited: row.is_edited ?? false,
    isHidden: row.is_hidden ?? false,
  };
}


export async function listSupabaseReviewsForRestaurant(
  restaurantId: string,
  options: { cursor?: string | null; pageSize?: number; sort?: "recent" | "popular" } = {},
): Promise<ReviewPage> {
  const { cursor, pageSize = PAGE_SIZE, sort = "recent" } = options;
  if (!SUPABASE_UUID.test(restaurantId)) throw new Error("Invalid restaurant ID.");
  const page=await collectSupabasePage<SupabaseReviewRow>("restaurant_review_page",{ target_restaurant:restaurantId,sort_by:sort },pageSize,cursor);
  return { ...page,items:page.items.map(mapSupabaseReview) };
}

export async function getSupabaseRestaurantReviewStats(
  restaurantId: string,
): Promise<{ count: number; average: number }> {
  const { count,average }=await getSupabaseRestaurantRatingDistribution(restaurantId);
  return { count,average };
}

export async function getSupabaseRestaurantRatingDistribution(
  restaurantId: string,
): Promise<RatingDistribution> {
  const buckets: Record<RatingValue, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (!SUPABASE_UUID.test(restaurantId)) return { count:0,average:0,buckets };
  try {
    const { data,error }=await supabase.rpc("restaurant_rating_distribution",{ target_restaurant:restaurantId });
    return error || !data ? { count:0,average:0,buckets } : data as RatingDistribution;
  } catch { return { count:0,average:0,buckets }; }
}

export async function getSupabaseReviewStatsForRestaurants(
  restaurantIds: string[],
): Promise<Map<string, { count: number; average: number }>> {
  const ids = [...new Set(restaurantIds.filter(id => SUPABASE_UUID.test(id)))];
  if (ids.length === 0) return new Map();
  const result=new Map<string,{ count:number;average:number }>();
  try {
    for (let start=0;start<ids.length;start+=100) {
      const { data,error }=await supabase.rpc("restaurant_review_stats",{ target_ids:ids.slice(start,start+100) });
      if (error) return new Map();
      for (const row of data ?? []) result.set(row.restaurant_id,{ count:Number(row.count),average:Number(row.average) });
    }
    return result;
  } catch { return new Map(); }
}

type FeedOptions={cursor?:string|null;pageSize?:number};
const emptyReviewPage=():ReviewPage=>({items:[],total:0,hasMore:false,nextCursor:null});
async function communityReviewPage(args:Record<string,unknown>,options:FeedOptions):Promise<ReviewPage> {
  const page=await collectSupabaseMemberPage<SupabaseReviewRow>("community_review_page",args,options.pageSize ?? PAGE_SIZE,options.cursor);
  return {...page,items:page.items.map(mapSupabaseReview)};
}
export const listSupabaseLatestReviews=(options:FeedOptions={})=>communityReviewPage({following_only:false},options);
export async function listSupabaseReviewsByFollowing(followingIds:string[],options:FeedOptions={}):Promise<ReviewPage> {
  if (!followingIds.length) return emptyReviewPage();
  // Compatibility argument only. SQL uses the caller's complete follow graph.
  return communityReviewPage({following_only:true},options);
}
export async function listSupabaseReviewsByUser(userId:string,options:FeedOptions={}):Promise<ReviewPage> {
  if (!SUPABASE_UUID.test(userId)) throw new Error("Invalid user ID.");
  return communityReviewPage({target_user:userId,following_only:false},options);
}
async function reviewDetail(name:string,args:Record<string,unknown>):Promise<Review|null> {
  try {
    const {data,error}=await requestSupabaseRpc(name,args);
    return error || !data?.id ? null : mapSupabaseReview(data as SupabaseReviewRow);
  } catch {return null;}
}
export async function getSupabaseReviewById(id:string):Promise<Review|null> {
  return SUPABASE_UUID.test(id) ? reviewDetail("community_review_detail",{target_review:id}) : null;
}
export async function getMySupabaseReviewForRestaurant(id:string):Promise<Review|null> {
  return SUPABASE_UUID.test(id) ? reviewDetail("my_restaurant_review",{target_restaurant:id}) : null;
}
export async function getSupabaseUserReviewStats(userId:string):Promise<{reviewCount:number;averageRating:number;parishesVisited:number}> {
  const empty={reviewCount:0,averageRating:0,parishesVisited:0};
  if (!SUPABASE_UUID.test(userId)) return empty;
  try {
    const {data,error}=await requestSupabaseRpc("user_review_statistics",{target_user:userId});
    return error || !data ? empty : data;
  } catch {return empty;}
}
