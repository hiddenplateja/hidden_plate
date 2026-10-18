import { supabase } from "@/services/supabase";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { requireSupabaseDataSession, rpcForSupabaseDataSession, type SupabaseDataSession } from "@/services/supabaseDataRequest";

export type SupabasePageRequest = (name: string, args: Record<string, unknown>) => PromiseLike<{
  data: unknown; error: { message: string } | null;
}>;
const sharedRequest: SupabasePageRequest = (name, args) => supabase.rpc(name, args);

/** Collect bounded 250-row RPC pages, including a lookahead, up to the map's 2000. */
export async function collectSupabasePage<Row extends { id:string }>(name:string,args:Record<string,unknown>,requested:number,cursor?:string|null,request:SupabasePageRequest=sharedRequest) {
  if (cursor && !SUPABASE_UUID.test(cursor)) throw new Error("Invalid cursor. Refresh the list.");
  const wanted=Number.isFinite(requested) ? Math.max(1,Math.min(2000,Math.trunc(requested))) : 25;
  const items:Row[]=[]; let nextCursor=cursor ?? null; let hasMore=false; let total=0;
  do {
    const limit=Math.min(250,wanted-items.length);
    const { data:rawData,error }=await request(name,{ ...args,after_id:nextCursor,page_size:limit });
    if (error) throw new Error(error.message);
    const data=rawData as {items?:unknown[];total?:unknown}|null;
    if (!Array.isArray(data?.items) || typeof data.total!=="number") throw new Error("Couldn't load this page.");
    const rows=(data.items as Row[]).slice(0,limit);
    items.push(...rows); total=data.total; hasMore=data.items.length>limit;
    const last=rows.at(-1)?.id ?? null;
    if (hasMore && (!last || last===nextCursor)) throw new Error("Couldn't continue this page.");
    nextCursor=last;
  } while (hasMore && items.length<wanted);
  return { items,total,hasMore,nextCursor:items.at(-1)?.id ?? null };
}

/** Compatibility array/Set readers must not silently stop at the API's row cap.
 * Uses bounded requests and rejects repeated cursors/rows rather than returning
 * a partial hidden-user set. New screens can use individual cursor pages.
 */
export async function collectAllSupabasePages<Row extends { id: string }>(name: string, args: Record<string, unknown>, request: SupabasePageRequest = sharedRequest) {
  const items: Row[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const page: { items: Row[]; total: number; hasMore: boolean; nextCursor: string | null } =
      await collectSupabasePage<Row>(name, args, 250, cursor, request);
    for (const row of page.items) {
      if (!SUPABASE_UUID.test(row.id) || seen.has(row.id)) throw new Error("Couldn't continue this list. Refresh it.");
      seen.add(row.id); items.push(row);
    }
    if (!page.hasMore) return items;
    if (!page.nextCursor || page.nextCursor === cursor) throw new Error("Couldn't continue this list. Refresh it.");
    cursor = page.nextCursor;
  }
}

/** Member-only paging keeps one original caller through every internal page. */
export async function collectSupabaseMemberPage<Row extends { id: string }>(name: string, args: Record<string, unknown>, requested: number,
  cursor?: string | null, expected?: SupabaseDataSession) {
  const pinned = expected ?? await requireSupabaseDataSession();
  return collectSupabasePage<Row>(name, args, requested, cursor, (rpc, params) => rpcForSupabaseDataSession(pinned, rpc, params));
}
export async function collectAllSupabaseMemberPages<Row extends { id: string }>(name: string, args: Record<string, unknown>, expected?: SupabaseDataSession) {
  const pinned = expected ?? await requireSupabaseDataSession();
  return collectAllSupabasePages<Row>(name, args, (rpc, params) => rpcForSupabaseDataSession(pinned, rpc, params));
}
