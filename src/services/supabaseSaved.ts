// Screen-compatible saves: composite keys are opaque UI identifiers, not row IDs.
import { pinSupabaseSession, currentSupabaseSessionIdentity } from "@/services/supabasePinnedSession";
import { collectSupabasePage, type SupabasePageRequest } from "@/services/supabasePagination";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { withRequestTimeout } from "@/utils/withRequestTimeout";
import type { ListType, SavedDoc } from "@/services/saved";
import type { Restaurant } from "@/types/restaurant";

type Pinned = NonNullable<Awaited<ReturnType<typeof pinSupabaseSession>>>;
type SavedRow = { id: string; created_at: string; list_type: ListType };
const listTypes: readonly ListType[] = ["favorite", "want_to_go", "visited"];
const emptyStatus = (): Record<ListType, string | null> => ({ favorite: null, want_to_go: null, visited: null });
function savedId(userId: string, restaurantId: string, listType: ListType) { return `${userId}:${restaurantId}:${listType}`; }
function validTarget(restaurantId: string, listType?: ListType) {
  if (!SUPABASE_UUID.test(restaurantId) || (listType !== undefined && !listTypes.includes(listType))) throw new Error("Invalid saved restaurant.");
}
async function assertCurrent(pinned: Pinned) {
  const current = await currentSupabaseSessionIdentity();
  if (current?.userId !== pinned.userId || current.accessToken !== pinned.accessToken) throw new Error("Your account changed. Please try again.");
}
async function statusFor(pinned: Pinned, restaurantId: string) {
  const { data, error } = await withRequestTimeout(5000, signal => pinned.client.from("saved_restaurants").select("list_type")
    .eq("user_id", pinned.userId).eq("restaurant_id", restaurantId)
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal));
  if (error) throw new Error(error.message);
  const status = emptyStatus();
  for (const row of data ?? []) if (listTypes.includes(row.list_type)) status[row.list_type as ListType] = savedId(pinned.userId, restaurantId, row.list_type);
  await assertCurrent(pinned);
  return status;
}
export async function getSupabaseScreenSavedStatus(restaurantId: string): Promise<Record<ListType, string | null>> {
  try {
    validTarget(restaurantId);
    const pinned = await pinSupabaseSession();
    return pinned ? await statusFor(pinned, restaurantId) : emptyStatus();
  } catch { return emptyStatus(); }
}
export async function toggleSupabaseScreenSaved(restaurantId: string, listType: ListType, currentStatus: Record<ListType, string | null>): Promise<Record<ListType, string | null>> {
  validTarget(restaurantId, listType);
  const pinned = await pinSupabaseSession();
  if (!pinned) throw new Error("You must be signed in.");
  const { data, error } = await withRequestTimeout(5000, signal => pinned.client.rpc("set_member_saved", { target_restaurant: restaurantId, saved_list: listType, should_save: !currentStatus[listType] })
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal));
  if (error) throw new Error(error.message);
  if (data !== restaurantId) throw new Error("Couldn't update this saved restaurant.");
  // The database atomically enforces want-to-go/visited exclusivity; don't
  // reconstruct it from stale local state or perform a second client write.
  return statusFor(pinned, restaurantId);
}
async function savedRowsFor(pinned: Pinned, listType: ListType | undefined, limit: number): Promise<SavedDoc[]> {
  if (listType !== undefined && !listTypes.includes(listType)) throw new Error("Invalid saved list.");
  const wanted = Number.isFinite(limit) ? Math.max(0, Math.min(2000, Math.trunc(limit))) : 200;
  if (!wanted) return [];
  const request: SupabasePageRequest = (name, args) => withRequestTimeout(5000, signal => pinned.client.rpc(name, args)
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`).abortSignal(signal));
  const pages = await Promise.all((listType ? [listType] : listTypes).map(type =>
    collectSupabasePage<SavedRow>("member_saved_page", { saved_list: type }, wanted, undefined, request)));
  const rows = pages.flatMap(page => page.items).map(row => {
    validTarget(row.id, row.list_type);
    if (!listTypes.includes(row.list_type) || !Number.isFinite(Date.parse(row.created_at))) throw new Error("Couldn't load your saved restaurants.");
    return { id: savedId(pinned.userId, row.id, row.list_type), userId: pinned.userId,
      restaurantId: row.id, listType: row.list_type, createdAt: row.created_at };
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)).slice(0, wanted);
  await assertCurrent(pinned);
  return rows;
}
export async function listSupabaseScreenSavedByUser(listType?: ListType, limit = 200): Promise<SavedDoc[]> {
  const pinned = await pinSupabaseSession();
  return pinned ? savedRowsFor(pinned, listType, limit) : [];
}
export async function listSupabaseScreenSavedRestaurants(listType: ListType, limit = 200): Promise<{ saved: SavedDoc; restaurant: Restaurant | null }[]> {
  const pinned = await pinSupabaseSession();
  if (!pinned) return [];
  const rows = await savedRowsFor(pinned, listType, limit);
  if (!rows.length) return [];
  const restaurants = await getSupabaseRestaurantsByIds(rows.map(row => row.restaurantId)).catch(() => new Map<string, Restaurant>());
  await assertCurrent(pinned);
  // Keep missing listings so the existing "Currently unavailable" UI remains.
  return rows.map(saved => ({ saved, restaurant: restaurants.get(saved.restaurantId) ?? null }));
}
