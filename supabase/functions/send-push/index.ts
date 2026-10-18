import { withSupabase } from "npm:@supabase/server@1.9.0";

// Database webhook only. Never accept an app user's JWT or notification text.
Deno.serve(withSupabase({ auth: "secret" }, async (req, ctx) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const db = ctx.supabaseAdmin;
  try {
    const input = await req.json();
    const retry = input.retry === true;
    if (!retry && (input.type !== "INSERT" || input.schema !== "public" ||
      input.table !== "notifications" || typeof input.record?.id !== "string")) {
      return Response.json({ error: "Invalid webhook" }, { status: 400 });
    }
    const { data: jobs, error } = await db.rpc("claim_notification_push", {
      target_notification: retry ? null : input.record.id,
    });
    if (error) throw error;
    let accepted = 0;
    await Promise.all((jobs ?? []).map(async (job: { delivery_id: string; notification_id: string; push_token_id: string; token: string }) => {
      const finish = async (status: string, last_error: string | null = null, ticket_id: string | null = null) => {
        const { error } = await db.from("push_deliveries").update({ status, last_error, ticket_id,
          lease_until: status === "failed" ? new Date(Date.now() + 120000).toISOString() : null,
        }).eq("id", job.delivery_id).eq("status", "processing");
        if (error) throw error;
      };
      try {
        const { data: n, error: ne } = await db.from("notifications").select("*").eq("id", job.notification_id).maybeSingle();
        if (ne) throw ne;
        if (!n) { await finish("skipped"); return; }
        const { data: profile, error: pe } = await db.from("profiles").select("preferences,is_banned").eq("id", n.user_id).single();
        if (pe) throw pe;
        const prefKey = ({ like: "notifyOnLike", comment: "notifyOnComment", follow: "notifyOnFollow" } as Record<string,string>)[n.type] ?? "notifyOnBroadcast";
        const prefs = profile.preferences ?? {};
        if (profile.is_banned || prefs.notificationsEnabled === false || prefs[prefKey] === false) {
          await finish("skipped"); return;
        }
        if (n.actor_id) {
          const { count, error: be } = await db.from("blocks").select("blocker_id", { count: "exact", head: true })
            .or(`and(blocker_id.eq.${n.actor_id},blocked_id.eq.${n.user_id}),and(blocker_id.eq.${n.user_id},blocked_id.eq.${n.actor_id})`);
          if (be) throw be;
          if (count) { await finish("skipped"); return; }
        }
        const headers: Record<string,string> = { "Content-Type": "application/json", Accept: "application/json" };
        const expoKey = Deno.env.get("EXPO_ACCESS_TOKEN");
        if (expoKey) headers.Authorization = `Bearer ${expoKey}`;
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST", headers, signal: AbortSignal.timeout(10000),
          body: JSON.stringify({ to: job.token, sound: "default", title: n.title, body: n.body,
            data: { ...(n.data ?? {}), type: n.type, notificationId: n.id, actorId: n.actor_id ?? "" }, channelId: "default" }),
        });
        if (!response.ok) throw new Error(`Expo HTTP ${response.status}`);
        const payload = await response.json();
        const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
        if (ticket?.status === "ok" && typeof ticket.id === "string") {
          await finish("accepted", null, ticket.id); accepted++;
        } else {
          const code = ticket?.details?.error ?? "ExpoRejected";
          await finish(code === "DeviceNotRegistered" ? "skipped" : "failed", code);
          if (code === "DeviceNotRegistered") {
            const { error: de } = await db.from("push_tokens").delete().eq("id", job.push_token_id).eq("token",job.token);
            if (de) throw de;
          }
        }
      } catch {
        // Do not log push tokens, service keys, or private notification content.
        await finish("failed", "Delivery attempt failed");
      }
    }));
    return Response.json({ processed: jobs?.length ?? 0, accepted });
  } catch {
    return Response.json({ error: "Push processing failed" }, { status: 500 });
  }
}));
