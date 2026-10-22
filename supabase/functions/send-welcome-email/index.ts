import { withSupabase } from "npm:@supabase/server@1.9.0";
import { sendResendEmail } from "../_shared/authEmails.ts";
import { deliverWelcomeEmails, type WelcomeAdmin } from "../_shared/welcomeEmails.ts";

// Private queue only. No client-supplied recipient, message or account ID.
Deno.serve(withSupabase({ auth: "secret" }, async (req, ctx) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    if (await req.text() !== "{}") return Response.json({ error: "Send an empty object" }, { status: 400 });
    if (!Deno.env.get("RESEND_API_KEY") || !Deno.env.get("AUTH_EMAIL_FROM")) throw new Error("Sender not configured");
    // Narrow the SDK's deeply generic client to the tested minimal protocol;
    // queue/identity/profile responses are checked by the processor at runtime.
    const summary = await deliverWelcomeEmails(ctx.supabaseAdmin as unknown as WelcomeAdmin, (email, key) =>
      sendResendEmail(Deno.env.get("RESEND_API_KEY")!, Deno.env.get("AUTH_EMAIL_FROM")!, email, key));
    return Response.json(summary);
  } catch { return Response.json({ error: "Welcome delivery failed" }, { status: 503 }); }
}));
