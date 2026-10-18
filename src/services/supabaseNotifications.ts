import { assertSupabaseDataSession, requireSupabaseDataSession, requestSupabaseRpc, restForSupabaseDataSession, rpcForSupabaseDataSession } from "@/services/supabaseDataRequest";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { collectSupabasePage } from "@/services/supabasePagination";
import type { AppNotification, NotificationData, NotificationPage, NotificationType } from "@/types/notification";

type Row = { id: string; user_id: string; actor_id: string | null; type: NotificationType; title: string; body: string; data: NotificationData; is_read: boolean; created_at: string };
function map(row: Row): AppNotification {
  let data:unknown=row.data;
  if (typeof data==="string") { try {data=JSON.parse(data);} catch {data={};} }
  return { id: row.id, userId: row.user_id, actorId: row.actor_id ?? "", type: row.type,
    title: row.title, body: row.body, data: data && typeof data==="object" && !Array.isArray(data) ? data as NotificationData : {}, isRead: row.is_read ?? false, createdAt: row.created_at };
}
/** RLS applies the same active-account/blocked-actor filters as the inbox RPC. */
export async function resolveSupabasePushNotification(id: string, expectedUserId: string): Promise<AppNotification | null> {
  if (!SUPABASE_UUID.test(id)) return null;
  try {
    const pinned = await requireSupabaseDataSession();
    if (pinned.userId !== expectedUserId) return null;
    const { data, error } = await restForSupabaseDataSession(pinned, client => client.from("notifications")
      .select("*").eq("id", id).eq("user_id", pinned.userId).maybeSingle());
    return error || !data || data.id !== id || data.user_id !== pinned.userId ? null : map(data as Row);
  } catch { return null; }
}
export async function listSupabaseNotifications(options:{cursor?:string|null;pageSize?:number}={}):Promise<NotificationPage> {
  const pinned = await requireSupabaseDataSession().catch(() => null);
  if (!pinned) return {items:[],total:0,hasMore:false,nextCursor:null};
  const wanted=Number.isFinite(options.pageSize) ? Math.max(1,Math.min(100,Math.trunc(options.pageSize!))) : 20;
  const result=await collectSupabasePage<Row>("my_notification_page",{},wanted,options.cursor,
    (name, args) => rpcForSupabaseDataSession(pinned, name, args));
  if (result.items.some(row => row.user_id !== pinned.userId)) throw new Error("Couldn't load your inbox.");
  return {...result,items:result.items.map(map)};
}
export async function getSupabaseUnreadCount(): Promise<number> {
  try {
    const {data,error}=await requestSupabaseRpc("my_unread_notification_count");
    return !error && Number.isInteger(Number(data)) && Number(data) >= 0 ? Number(data) : 0;
  } catch {return 0;}
}
export async function markSupabaseNotificationsRead(id?: string): Promise<void> {
  const pinned = await requireSupabaseDataSession();
  await markReadForSession(pinned, id);
}
async function markReadForSession(pinned: Awaited<ReturnType<typeof requireSupabaseDataSession>>, id?: string) {
  await assertSupabaseDataSession(pinned);
  let query = pinned.client.from("notifications").update({ is_read: true }).eq("user_id", pinned.userId);
  if (id) query = query.eq("id", id);
  const { error } = await query.setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseDataSession(pinned);
  if (error) throw new Error(error.message);
}
export const markSupabaseNotificationRead=(id:string)=>markSupabaseNotificationsRead(id);
export async function markAllSupabaseNotificationsRead():Promise<void> {
  const pinned = await requireSupabaseDataSession().catch(() => null);
  if (pinned) await markReadForSession(pinned);
}
export async function deleteSupabaseNotification(id: string): Promise<void> {
  const pinned = await requireSupabaseDataSession();
  await assertSupabaseDataSession(pinned);
  const { error } = await pinned.client.from("notifications").delete().eq("id", id).eq("user_id", pinned.userId)
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseDataSession(pinned);
  if (error) throw new Error(error.message);
}
export async function registerSupabasePushToken(token: string, platform: string): Promise<void> {
  const { error } = await requestSupabaseRpc("register_push_token", { push_token: token, device_platform: platform });
  if (error) throw new Error(error.message);
}
export async function clearSupabasePushToken(token: string): Promise<void> {
  const pinned = await requireSupabaseDataSession();
  await assertSupabaseDataSession(pinned);
  const { error } = await pinned.client.from("push_tokens").delete().eq("user_id", pinned.userId).eq("token", token)
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseDataSession(pinned);
  if (error) throw new Error(error.message);
}
