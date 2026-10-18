import { withSupabase } from "npm:@supabase/server@1.9.0";
import { finishDeletion } from "../_shared/accountDeletion.ts";

// Trusted maintenance only; operates ONLY on persisted self-deletion requests.
// No arbitrary user IDs, JWTs or job fields are accepted from the caller.
Deno.serve(withSupabase({ auth: "secret" }, async (req, ctx) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const { data, error } = await ctx.supabaseAdmin.rpc("pending_account_deletions");
    if (error || !Array.isArray(data)) throw new Error("Queue unavailable.");
    let completed = 0, pending = 0;
    // Sequential, bounded work: Auth rate limits must not fan out a deletion storm.
    for (const userId of data) {
      if (typeof userId !== "string") throw new Error("Invalid queue result.");
      try { await finishDeletion(ctx.supabaseAdmin, userId); completed++; }
      catch { pending++; }
    }
    return Response.json({ completed, pending });
  } catch { return Response.json({ error: "Deletion maintenance unavailable." }, { status: 503 }); }
}));
