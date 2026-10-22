import { deliverWelcomeEmails, type WelcomeAdmin } from "./welcomeEmails.ts";
function assert(value: unknown, message = "Assertion failed") { if (!value) throw new Error(message); }
const id = "fa280000-0000-4000-8000-000000000001", lease = "fa280000-0000-4000-8000-000000000002";
function setup(profile: unknown = { is_banned: false, signup_pending: null }) {
  const outcomes: unknown[] = [], recipients: string[] = [];
  const db: WelcomeAdmin = {
    rpc: (name, args) => { if (name === "finish_welcome_email") outcomes.push(args); return Promise.resolve({ data: name === "claim_welcome_emails" ? [{ user_id: id, lease_id: lease }] : null, error: null }); },
    auth: { admin: { getUserById: async userId => { assert(userId === id); return { data: { user: { email: "verified@example.test", email_confirmed_at: "confirmed" } }, error: null }; } } },
    from: table => { assert(table === "profiles"); return { select: () => ({ eq: (column, userId) => { assert(column === "id" && userId === id); return { maybeSingle: async () => ({ data: profile, error: null }) }; } }) }; },
  };
  const send: Parameters<typeof deliverWelcomeEmails>[1] = async (email, key) => {
    assert(key === `welcome/${id}` && email.subject === "Welcome to Hidden Plate"); recipients.push(email.to);
  };
  return { db, send, outcomes, recipients };
}
Deno.test("welcome comes from authoritative Auth recipient and records its lease", async () => {
  const s = setup(), result = await deliverWelcomeEmails(s.db, s.send);
  assert(result.accepted === 1 && s.recipients[0] === "verified@example.test");
  assert(JSON.stringify(s.outcomes[0]) === JSON.stringify({ target_user: id, expected_lease: lease, outcome: "sent" }));
});
for (const profile of [null, { is_banned: true, signup_pending: null }, { is_banned: false, signup_pending: { user_id: id } },
  { is_banned: false, signup_pending: [{ user_id: id }] }, { is_banned: false }, {}]) Deno.test(`ineligible profile ${JSON.stringify(profile)} cannot receive welcome`, async () => {
  const s = setup(profile), result = await deliverWelcomeEmails(s.db, s.send);
  assert(result.accepted === 0 && s.recipients.length === 0 && (s.outcomes[0] as { outcome: string }).outcome === "skipped");
});
Deno.test("provider failures remain retryable, never falsely marked sent", async () => {
  const s = setup(), result = await deliverWelcomeEmails(s.db, async () => { throw new Error("offline"); });
  assert(result.accepted === 0 && (s.outcomes[0] as { outcome: string }).outcome === "failed");
});
Deno.test("uncertain identity failure cannot send a welcome", async () => {
  const s = setup(); s.db.auth.admin.getUserById = async () => ({ data: { user: null }, error: "lookup unavailable" });
  assert((await deliverWelcomeEmails(s.db, s.send)).accepted === 0 && s.recipients.length === 0);
});
Deno.test("claim failure does not send or finish a fake job", async () => {
  const s = setup(); s.db.rpc = async () => ({ data: null, error: "unavailable" });
  let failed = false; try { await deliverWelcomeEmails(s.db, s.send); } catch { failed = true; }
  assert(failed && s.recipients.length === 0 && s.outcomes.length === 0);
});
