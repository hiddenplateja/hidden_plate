import { assertSupabaseDataSession, requireSupabaseDataSession, requestSupabaseRpc, restForSupabaseDataSession, type SupabaseDataSession } from "@/services/supabaseDataRequest";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import { getSupabaseReviewStatsForRestaurants } from "@/services/supabaseReviews";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { collectAllSupabaseMemberPages, collectSupabaseMemberPage } from "@/services/supabasePagination";
import type { CreateListInput, List, UpdateListInput } from "@/types/list";

type CollectionRow = { id: string; owner_id: string; title: string; description: string | null; is_public: boolean; restaurant_ids: string[]; cover_restaurant_id: string | null; created_at: string; updated_at: string };
function mapCollection(row: CollectionRow): List {
  return { id: row.id, ownerId: row.owner_id, title: row.title, description: row.description,
    isPublic: row.is_public, restaurantIds: row.restaurant_ids ?? [], coverRestaurantId: row.cover_restaurant_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function requireCollectionId(id: string) {
  if (!SUPABASE_UUID.test(id)) throw new Error("Invalid collection ID.");
}
function collectionResult(data: unknown): List {
  const row = (Array.isArray(data) ? data[0] : data) as CollectionRow | null;
  if (!row?.id || !Array.isArray(row.restaurant_ids)) throw new Error("Couldn't load the collection.");
  return mapCollection(row);
}
export async function getSupabaseCollection(id: string): Promise<List> {
  requireCollectionId(id);
  return collectionForSession(await requireSupabaseDataSession(), id);
}
async function collectionForSession(pinned: SupabaseDataSession, id: string): Promise<List> {
  const { data, error } = await restForSupabaseDataSession(pinned, client => client.from("collections").select().eq("id", id).single());
  if (error) throw new Error(error.message);
  return mapCollection(data as CollectionRow);
}
export async function createSupabaseCollection(input: CreateListInput): Promise<List> {
  if (!input.title.trim()) throw new Error("Enter a collection title.");
  const { data, error } = await requestSupabaseRpc("write_member_collection", { target_collection: null,
    collection_patch: { title: input.title.trim(), description: input.description?.trim() || null, is_public: !!input.isPublic } });
  if (error) throw new Error(error.message);
  return collectionResult(data);
}
export async function updateSupabaseCollection(id: string, patch: UpdateListInput): Promise<List> {
  requireCollectionId(id);
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) { if (!patch.title.trim()) throw new Error("Enter a collection title."); update.title = patch.title.trim(); }
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.isPublic !== undefined) update.is_public = patch.isPublic;
  const { data, error } = await requestSupabaseRpc("write_member_collection", { target_collection: id, collection_patch: update });
  if (error) throw new Error(error.message);
  return collectionResult(data);
}
export async function deleteSupabaseCollection(id: string): Promise<void> {
  requireCollectionId(id);
  const { data, error } = await requestSupabaseRpc("delete_member_collection", { target_collection: id });
  if (error) throw new Error(error.message);
  if (data !== id) throw new Error("Couldn't delete the collection.");
}
export async function listSupabaseCollections(ownerId?: string, publicOnly = false): Promise<List[]> {
  return (await collectAllSupabaseMemberPages<CollectionRow>("member_collection_page", collectionPageArgs(ownerId, publicOnly))).map(mapCollection);
}
function collectionPageArgs(ownerId?: string, publicOnly = false) {
  if (ownerId !== undefined && !SUPABASE_UUID.test(ownerId)) throw new Error("Invalid user ID.");
  if (typeof publicOnly !== "boolean") throw new Error("Invalid collection query.");
  return { target_user: ownerId ?? null, public_only: publicOnly };
}
export async function listSupabaseCollectionPage(ownerId?: string, publicOnly = false, options: { cursor?: string | null; pageSize?: number } = {}) {
  const page = await collectSupabaseMemberPage<CollectionRow>("member_collection_page", collectionPageArgs(ownerId, publicOnly), options.pageSize ?? 30, options.cursor);
  return { ...page, items: page.items.map(mapCollection) };
}
export async function changeSupabaseCollectionMembership(id: string, restaurantId: string, add: boolean): Promise<List> {
  requireCollectionId(id);
  if (!SUPABASE_UUID.test(restaurantId) || typeof add !== "boolean") throw new Error("Invalid collection membership.");
  const { data, error } = await requestSupabaseRpc("change_collection_membership", { collection_id: id, restaurant_id: restaurantId, should_add: add });
  if (error) throw new Error(error.message);
  return collectionResult(data);
}
export async function getSupabaseCollectionWithRestaurants(id: string) {
  requireCollectionId(id);
  const pinned = await requireSupabaseDataSession();
  const list = await collectionForSession(pinned, id);
  if (!list.restaurantIds.length) return { list,restaurants:[] };
  const [restaurants,stats]=await Promise.all([getSupabaseRestaurantsByIds(list.restaurantIds),getSupabaseReviewStatsForRestaurants(list.restaurantIds)]);
  await assertSupabaseDataSession(pinned);
  return { list, restaurants: list.restaurantIds.flatMap((restaurantId) => {
    const restaurant = restaurants.get(restaurantId); const rating=stats.get(restaurantId);
    return restaurant ? [{ ...restaurant,...(rating ? { reviewCount:rating.count,averageRating:rating.average } : {}) }] : [];
  }) };
}
