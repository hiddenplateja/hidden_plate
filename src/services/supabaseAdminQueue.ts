// Staged queues: server-side admin checks and stable created_at/id pagination.
import { requestSupabaseRpc } from "@/services/supabaseDataRequest";

export type QueueKind = "review" | "comment" | "post" | "post_comment" | "bug" | "claim";
export type QueueOptions = { cursor?: string | null; pageSize?: number };
export const SUPABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function supabaseCommand(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await requestSupabaseRpc(name, args);
  if (error) throw new Error(error.message);
}

export async function supabaseQueuePage<Row extends { id: string }, Item extends { id: string }>(
  kind: QueueKind, map: (row: Row) => Item, opts: QueueOptions = {}, status: string | null = null,
) {
  const requested = opts.pageSize ?? (kind === "claim" ? 25 : 50);
  const pageSize = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.trunc(requested))) : 50;
  if (opts.cursor && !SUPABASE_UUID.test(opts.cursor)) throw new Error("Invalid queue cursor. Refresh the list.");
  const { data, error } = await requestSupabaseRpc("admin_queue_page", {
    queue_kind: kind, after_id: opts.cursor ?? null, page_size: pageSize, filter_status: status,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error("Couldn't load the admin queue.");
  const items = (data as Row[]).slice(0, pageSize).map(map);
  return { items, hasMore: data.length > pageSize, nextCursor: items.at(-1)?.id ?? null };
}

export async function dismissSupabaseReport(kind: Exclude<QueueKind, "claim">, id: string) {
  if (!SUPABASE_UUID.test(id)) throw new Error("Invalid report.");
  await supabaseCommand("admin_dismiss_report", { queue_kind: kind, report_id: id });
}
