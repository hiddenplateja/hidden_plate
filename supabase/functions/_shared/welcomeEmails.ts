import { welcomeEmail, type EmailMessage } from "./authEmails.ts";
type Result = { data: unknown; error: unknown };
export type WelcomeAdmin = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<Result>;
  auth: { admin: { getUserById: (id: string) => PromiseLike<{ data: { user: { email?: string; email_confirmed_at?: string } | null }; error: unknown }> } };
  from: (table: string) => { select: (columns: string) => { eq: (column: string, id: string) => { maybeSingle: () => PromiseLike<Result> } } };
};
export async function deliverWelcomeEmails(db: WelcomeAdmin, send: (email: EmailMessage, key: string) => Promise<void>) {
  const { data: jobs, error } = await db.rpc("claim_welcome_emails");
  if (error || !Array.isArray(jobs) || jobs.length > 10) throw new Error("Could not claim welcome jobs");
  let accepted = 0;
  await Promise.all(jobs.map(async job => {
    if (!job || typeof job.user_id !== "string" || typeof job.lease_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.user_id)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.lease_id)) throw new Error("Invalid welcome job");
    let outcome = "failed";
    try {
      const { data, error: identityError } = await db.auth.admin.getUserById(job.user_id);
      if (identityError || !data.user) throw new Error("Could not verify recipient");
      const { data: raw, error: profileError } = await db.from("profiles")
        .select("is_banned,signup_pending:auth_signup_pending(user_id)").eq("id", job.user_id).maybeSingle();
      if (profileError) throw new Error("Could not verify profile");
      const profile = raw as { is_banned: boolean; signup_pending: unknown } | null;
      const pending = profile?.signup_pending;
      if (!profile || profile.is_banned !== false || (Array.isArray(pending) ? pending.length > 0 : pending !== null)
        || !data.user.email_confirmed_at || !data.user.email) outcome = "skipped";
      else {
        await send(welcomeEmail(data.user.email), `welcome/${job.user_id}`);
        outcome = "sent"; accepted++;
      }
    } catch { /* Record only generic state, never private error text. */ }
    const { error: finishError } = await db.rpc("finish_welcome_email", {
      target_user: job.user_id, expected_lease: job.lease_id, outcome,
    });
    if (finishError) throw new Error("Could not record delivery");
  }));
  return { processed: jobs.length, accepted };
}
