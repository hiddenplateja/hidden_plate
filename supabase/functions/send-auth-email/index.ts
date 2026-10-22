import { withSupabase } from "npm:@supabase/server@1.9.0";
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { sendResendEmail } from "../_shared/authEmails.ts";
import { handleAuthEmail } from "../_shared/authEmailHook.ts";

// Not user/secret-key authenticated: verify Supabase Auth's signed webhook
// BEFORE using the admin client or processing any email content.
Deno.serve(withSupabase({ auth: "none" }, async (req, ctx) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!secret) return Response.json({ error: "Email hook is not configured" }, { status: 503 });
  return handleAuthEmail(req, {
    verify: (raw, headers) => new Webhook(secret.replace(/^v1,whsec_/, "")).verify(raw, headers),
    classifyPasswordEmail: async (id, userId, hash) => {
      const { data, error } = await ctx.supabaseAdmin.rpc("classify_signup_password_email", {
        delivery_id: id, target_user: userId, payload_sha256: hash,
      });
      if (error || typeof data !== "boolean") throw new Error("Could not check signup state");
      return data;
    },
    send: (email, key) => sendResendEmail(Deno.env.get("RESEND_API_KEY") ?? "", Deno.env.get("AUTH_EMAIL_FROM") ?? "", email, key),
    projectUrl: Deno.env.get("SUPABASE_URL")!,
  });
}));
