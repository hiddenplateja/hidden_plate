import * as Location from "expo-location";
import { assertSupabaseDataSession, requireSupabaseDataSession, requestSupabaseRpc, rpcForSupabaseDataSession, type SupabaseDataSession } from "@/services/supabaseDataRequest";
import { checkSupabaseIsAdmin } from "@/services/supabaseAdmin";
import { supabaseCommand, SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { mapSupabaseRestaurant, mapSupabaseRestaurantResult, restaurantSupabasePayload } from "@/services/supabaseRestaurants";
import type { RestaurantRow } from "@/services/supabaseRestaurants";
import { processSupabaseMediaCleanup } from "@/services/supabaseStorage";
import type { AdminRestaurantStatus, BulkImportResult, BulkImportRow } from "@/services/restaurants";
import type { CreateRestaurantInput, Restaurant, RestaurantPage, UpdateRestaurantInput } from "@/types/restaurant";

function validId(id: string) { if (!SUPABASE_UUID.test(id)) throw new Error("Invalid restaurant ID."); }
export async function adminCreateSupabaseRestaurant(input: CreateRestaurantInput): Promise<Restaurant> {
  const { data, error } = await requestSupabaseRpc("admin_write_restaurant", { payload: restaurantSupabasePayload(input,true), target_id: null });
  if (error) throw new Error(error.message);
  return mapSupabaseRestaurantResult(data);
}
export async function updateSupabaseRestaurant(id: string, patch: UpdateRestaurantInput): Promise<Restaurant> {
  validId(id);
  const { data, error } = await requestSupabaseRpc("admin_write_restaurant", { payload: restaurantSupabasePayload(patch,true), target_id: id });
  if (error) throw new Error(error.message);
  return mapSupabaseRestaurantResult(data);
}
export const setSupabaseRestaurantFlags = (id: string, flags: { isActive?: boolean; isVerified?: boolean; isFeatured?: boolean }) =>
  updateSupabaseRestaurant(id,flags);
export const approveSupabaseRestaurantSubmission = (id: string, opts: { verified?: boolean } = {}) =>
  updateSupabaseRestaurant(id,{ isActive: true, ...(opts.verified ? { isVerified: true } : {}) });

export async function listAdminSupabaseRestaurants(opts: { search?: string; status?: AdminRestaurantStatus; cursor?: string | null; pageSize?: number; claimedOnly?: boolean } = {}): Promise<RestaurantPage> {
  return adminRestaurantPage(opts);
}
async function adminRestaurantPage(opts: Parameters<typeof listAdminSupabaseRestaurants>[0] = {}, pinned?: SupabaseDataSession): Promise<RestaurantPage> {
  const requested = opts.pageSize ?? 25;
  const pageSize = Number.isFinite(requested) ? Math.max(1,Math.min(100,Math.trunc(requested))) : 25;
  if (opts.cursor) validId(opts.cursor);
  const { data, error } = await rpcForSupabaseDataSession(pinned ?? await requireSupabaseDataSession(), "admin_restaurant_page", { search_term: opts.search?.trim() ?? "", filter_status: opts.status ?? "all",
    after_id: opts.cursor ?? null, page_size: pageSize, claimed_only: opts.claimedOnly ?? false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data?.items) || typeof data.total !== "number") throw new Error("Couldn't load restaurants.");
  const items = (data.items as RestaurantRow[]).slice(0,pageSize).map(mapSupabaseRestaurant);
  return { items, total: data.total, hasMore: data.items.length>pageSize, nextCursor: items.at(-1)?.id ?? null };
}
export async function listClaimedSupabaseRestaurants(): Promise<Restaurant[]> {
  const pinned = await requireSupabaseDataSession();
  const items: Restaurant[] = []; let cursor: string | null = null;
  do {
    const page = await adminRestaurantPage({ claimedOnly: true, cursor, pageSize: 100 }, pinned);
    items.push(...page.items); if (!page.hasMore) break;
    if (!page.nextCursor || page.nextCursor===cursor) throw new Error("Couldn't continue the owners list.");
    cursor=page.nextCursor;
  } while (true);
  return items;
}
export async function getOwnedSupabaseRestaurants(userId: string): Promise<Restaurant[]> {
  if (!SUPABASE_UUID.test(userId)) return [];
  try {
    const pinned = await requireSupabaseDataSession();
    const { data, error } = await pinned.client.from("restaurants").select("*").eq("owner_id",userId).order("created_at",{ ascending:false }).limit(100)
      .setHeader("Authorization", `Bearer ${pinned.accessToken}`);
    await assertSupabaseDataSession(pinned);
    return error ? [] : ((data ?? []) as RestaurantRow[]).map(mapSupabaseRestaurant);
  } catch { return []; }
}
export async function setSupabaseRestaurantOwner(id: string, owner: string | null): Promise<void> {
  validId(id); if (owner!==null && !SUPABASE_UUID.test(owner)) throw new Error("Invalid owner ID.");
  await supabaseCommand("admin_set_restaurant_owner",{ target_id:id,new_owner:owner });
}
export async function setSupabaseRestaurantListingPaidUntil(id: string, expiry: string | null): Promise<void> {
  validId(id); if (expiry!==null && !Number.isFinite(Date.parse(expiry))) throw new Error("Invalid listing expiry.");
  await supabaseCommand("admin_set_listing_expiry",{ target_id:id,paid_until:expiry });
}
export async function rebuildSupabaseRestaurantSearch(): Promise<{ scanned: number; updated: number }> {
  const { data,error } = await requestSupabaseRpc("admin_rebuild_restaurant_search");
  if (error) throw new Error(error.message);
  return data;
}
export async function deleteSupabaseRestaurant(id: string): Promise<void> {
  validId(id);
  const pinned = await requireSupabaseDataSession();
  const { error } = await rpcForSupabaseDataSession(pinned, "admin_delete_restaurant",{ target_id:id });
  if (error) throw new Error(error.message);
  // Triggers record removed keys in the same transaction. The Worker receives
  // only database-leased, unreferenced jobs, never arbitrary keys from the app.
  await processSupabaseMediaCleanup(pinned).catch(() => undefined);
}
export async function bulkImportSupabaseRestaurants(rows: BulkImportRow[]): Promise<BulkImportResult> {
  const pinned = await requireSupabaseDataSession();
  if (!(await checkSupabaseIsAdmin(pinned))) throw new Error("Admin access required.");
  const result: BulkImportResult={ created:0,failed:0,errors:[] };
  for (const row of rows) {
    await assertSupabaseDataSession(pinned);
    const label=row?.name?.trim() || "(unnamed)";
    try {
      if (!row?.name?.trim() || row.name.trim().length<2) throw new Error("missing name");
      if (!row.address?.trim()) throw new Error("missing address");
      if (!row.parish) throw new Error("missing parish");
      if (!(row.cuisines ?? []).some(t => t.trim()) && !(row.categories ?? []).some(t => t.trim())) throw new Error("needs at least one cuisine or category");
      let lat=row.latitude; let lng=row.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat===0 && lng===0)) {
        const matches=await Location.geocodeAsync(`${row.address.trim()}, ${row.city ?? ""} ${row.parish.replace(/_/g," ")}, Jamaica`).catch(() => []);
        const first=matches[0]; if (!first || !Number.isFinite(first.latitude) || !Number.isFinite(first.longitude)) throw new Error("no coordinates — add latitude/longitude");
        lat=first.latitude; lng=first.longitude;
      }
      const { data, error } = await rpcForSupabaseDataSession(pinned, "admin_write_restaurant", {
        target_id: null, payload: restaurantSupabasePayload({ ...row, latitude:lat!,longitude:lng!,cuisines:row.cuisines ?? [],categories:row.categories ?? [],
          imageIds:[],isActive:true,isVerified:true,isFeatured:false }, true),
      });
      if (error) throw new Error(error.message);
      mapSupabaseRestaurantResult(data);
      result.created++;
    } catch (error) {
      // Do not keep geocoding/importing rows as a replacement admin account.
      await assertSupabaseDataSession(pinned);
      result.failed++; result.errors.push(`${label}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  return result;
}
