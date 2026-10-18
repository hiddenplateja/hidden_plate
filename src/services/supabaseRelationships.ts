import { assertSupabaseDataSession, requireSupabaseDataSession, requestSupabaseRpc, restForSupabaseDataSession, type SupabaseDataSession } from "@/services/supabaseDataRequest";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import {collectSupabaseMemberPage,collectAllSupabaseMemberPages} from "@/services/supabasePagination";
import {SUPABASE_UUID} from "@/services/supabaseAdminQueue";
import {mapSupabasePublicProfile,type SupabasePublicProfile} from "@/services/supabaseUsers";
import type {User} from "@/types/user";

export type SupabaseSavedListType = "favorite" | "want_to_go" | "visited";
function fail(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function setSupabaseSaved(restaurantId: string, listType: SupabaseSavedListType, saved: boolean): Promise<void> {
  if (!SUPABASE_UUID.test(restaurantId) || !["favorite", "want_to_go", "visited"].includes(listType) || typeof saved !== "boolean") {
    throw new Error("Invalid saved restaurant.");
  }
  const { data, error } = await requestSupabaseRpc("set_member_saved", {
    target_restaurant: restaurantId, saved_list: listType, should_save: saved,
  });
  fail(error);
  if (data !== restaurantId) throw new Error("Couldn't update this saved restaurant.");
}
export async function getSupabaseSavedStatus(restaurantId: string): Promise<Record<SupabaseSavedListType, boolean>> {
  const pinned = await requireSupabaseDataSession();
  const { data, error } = await restForSupabaseDataSession(pinned, client => client.from("saved_restaurants").select("list_type").eq("user_id", pinned.userId).eq("restaurant_id", restaurantId));
  fail(error);
  const types = new Set(data?.map((row) => row.list_type));
  return { favorite: types.has("favorite"), want_to_go: types.has("want_to_go"), visited: types.has("visited") };
}
type SavedRow = { id: string; created_at: string; list_type: SupabaseSavedListType };
type RelationshipPageOptions = { cursor?: string | null; pageSize?: number };
function savedListArgs(listType: SupabaseSavedListType) {
  if (!["favorite", "want_to_go", "visited"].includes(listType)) throw new Error("Invalid saved list.");
  return { saved_list: listType };
}
async function hydrateSaved(rows: SavedRow[]) {
  const ids = rows.map(row => row.id);
  const restaurants = await getSupabaseRestaurantsByIds(ids);
  return ids.flatMap((id) => { const restaurant = restaurants.get(id); return restaurant ? [restaurant] : []; });
}
export async function listSupabaseSavedRestaurants(listType: SupabaseSavedListType) {
  const pinned = await requireSupabaseDataSession();
  const result = await hydrateSaved(await collectAllSupabaseMemberPages<SavedRow>("member_saved_page", savedListArgs(listType), pinned));
  await assertSupabaseDataSession(pinned);
  return result;
}
export async function listSupabaseSavedRestaurantPage(listType: SupabaseSavedListType, options: RelationshipPageOptions = {}) {
  const pinned = await requireSupabaseDataSession();
  const page = await collectSupabaseMemberPage<SavedRow>("member_saved_page", savedListArgs(listType), options.pageSize ?? 30, options.cursor, pinned);
  const items = await hydrateSaved(page.items);
  await assertSupabaseDataSession(pinned);
  return { ...page, items };
}
export async function getMySupabaseSavedCount(): Promise<number> {
  try {
    const { data, error } = await requestSupabaseRpc("member_saved_count");
    return !error && typeof data === "number" && Number.isSafeInteger(data) && data >= 0 ? data : 0;
  } catch { return 0; }
}
export async function setSupabaseFollowing(targetId: string, following: boolean): Promise<void> {
  await writeFollow(targetId,following);
}
async function writeFollow(targetId:string,following:boolean):Promise<string> {
  if (!SUPABASE_UUID.test(targetId) || typeof following!=="boolean") throw new Error("Invalid follow.");
  const {data,error}=await requestSupabaseRpc("set_member_follow",{target_user:targetId,following});
  fail(error);
  if (typeof data!=="string" || data!==targetId) throw new Error("Couldn't update this follow.");
  return data;
}
export const followSupabaseUser=(id:string)=>writeFollow(id,true);
export async function unfollowSupabaseUser(id:string):Promise<void>{await writeFollow(id,false);}
type FollowRow={id:string;created_at:string;profile:SupabasePublicProfile};
type FollowOptions={cursor?:string|null;pageSize?:number};
export interface SupabaseFollowListPage {items:User[];nextCursor:string|null;hasMore:boolean}
async function followPage(id:string,direction:"followers"|"following",options:FollowOptions,pinned?:SupabaseDataSession) {
  if (!SUPABASE_UUID.test(id)) throw new Error("Invalid user ID.");
  return collectSupabaseMemberPage<FollowRow>("member_follow_page",{target_user:id,direction},options.pageSize ?? 30,options.cursor,pinned);
}
async function listFollows(id:string,direction:"followers"|"following",options:FollowOptions):Promise<SupabaseFollowListPage> {
  try {
    const page=await followPage(id,direction,options);
    return {items:page.items.map(row=>mapSupabasePublicProfile(row.profile)),nextCursor:page.nextCursor,hasMore:page.hasMore};
  } catch {return {items:[],nextCursor:null,hasMore:false};}
}
export const listSupabaseFollowers=(id:string,options:FollowOptions={})=>listFollows(id,"followers",options);
export const listSupabaseFollowing=(id:string,options:FollowOptions={})=>listFollows(id,"following",options);
export async function getSupabaseFollowingIds(id?:string,limit=200):Promise<string[]> {
  try {
    const pinned = await requireSupabaseDataSession();
    return (await followPage(id ?? pinned.userId,"following",{pageSize:limit},pinned)).items.map(row=>row.id);
  } catch {return [];}
}
export async function getSupabaseFollowerIds(id:string,limit=200):Promise<string[]> {
  try {return (await followPage(id,"followers",{pageSize:limit})).items.map(row=>row.id);} catch {return [];}
}
export async function getSupabaseFollowCounts(id:string):Promise<{followerCount:number;followingCount:number}> {
  const empty={followerCount:0,followingCount:0};
  if (!SUPABASE_UUID.test(id)) return empty;
  try {const {data,error}=await requestSupabaseRpc("member_follow_counts",{target_user:id});return error || !data ? empty : data;} catch {return empty;}
}
export async function getSupabaseFollowingSetForUsers(userIds:string[]):Promise<Set<string>> {
  const ids=[...new Set(userIds.filter(id=>SUPABASE_UUID.test(id)))];const found=new Set<string>();
  if (!ids.length)return found;
  try {
    const pinned=await requireSupabaseDataSession();
    for(let start=0;start<ids.length;start+=100){
      const {data,error}=await restForSupabaseDataSession(pinned, client => client.from("follows").select("following_id").eq("follower_id",pinned.userId).in("following_id",ids.slice(start,start+100)));
      fail(error);for(const row of data ?? [])found.add(row.following_id as string);
    }return found;
  }catch{return new Set();}
}
export async function isSupabaseFollowing(id:string):Promise<boolean> {
  return (await getSupabaseFollowingSetForUsers([id])).has(id);
}
export async function setSupabaseBlocked(targetId: string, blocked: boolean): Promise<void> {
  if (!SUPABASE_UUID.test(targetId) || typeof blocked !== "boolean") throw new Error("Invalid block.");
  const { data, error } = await requestSupabaseRpc("set_member_block", { target_user: targetId, should_block: blocked });
  fail(error);
  if (data !== targetId) throw new Error("Couldn't update this block.");
}
export async function getSupabaseHiddenUserIds(): Promise<Set<string>> {
  const rows = await collectAllSupabaseMemberPages<{ id: string }>("member_hidden_user_page", {});
  return new Set(rows.map(row => row.id));
}
type BlockedProfileRow = { id: string; created_at: string; profile: SupabasePublicProfile };
export async function listSupabaseBlockedProfiles() {
  const rows = await collectAllSupabaseMemberPages<BlockedProfileRow>("member_blocked_profile_page", {});
  return rows.map(row => row.profile);
}
export async function isSupabaseBlocked(targetId: string): Promise<boolean> {
  if (!SUPABASE_UUID.test(targetId)) return false;
  try {
    const pinned = await requireSupabaseDataSession();
    const { data, error } = await restForSupabaseDataSession(pinned, client => client.from("blocks").select("blocked_id")
      .eq("blocker_id", pinned.userId).eq("blocked_id", targetId).limit(1));
    return !error && !!data?.length;
  } catch { return false; }
}
export async function listSupabaseBlockedProfilePage(options: RelationshipPageOptions = {}) {
  const page = await collectSupabaseMemberPage<BlockedProfileRow>("member_blocked_profile_page", {}, options.pageSize ?? 30, options.cursor);
  return { ...page, items: page.items.map(row => row.profile) };
}
