import { withSupabase } from "npm:@supabase/server@1.9.0";
import { finishDeletion, isEmptyDeletionRequest, prepareDeletion } from "../_shared/accountDeletion.ts";

Deno.serve(withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!await isEmptyDeletionRequest(req)) return Response.json({ success: false, error: "Send an empty request." }, { status: 400 });
  // Network validation rejects deleted/revoked identities, not just forged JWTs.
  const { data, error } = await ctx.supabase.auth.getUser();
  if (error || !data.user) return Response.json({ success: false, error: "Sign in to delete your account." }, { status: 401 });
  let prepared = false;
  try {
    await prepareDeletion(ctx.supabaseAdmin, data.user.id);
    prepared = true;
    const summary = await finishDeletion(ctx.supabaseAdmin, data.user.id);
    return Response.json({ success: true, summary });
  } catch {
    // Never return/log raw database details, email, JWT or user-supplied content.
    return Response.json({ success: false, error: prepared
      ? "Your profile has been removed, but login deletion still needs confirmation. Please retry or contact support."
      : "Account deletion could not start. Please try again." }, { status: 503 });
  }
}));
