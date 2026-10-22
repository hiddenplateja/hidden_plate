import { Webhook } from "npm:standardwebhooks@1.0.0";
import { authEmailEvent, renderAuthEmails, sendResendEmail, welcomeEmail, type EmailMessage } from "./authEmails.ts";
import { handleAuthEmail } from "./authEmailHook.ts";
function assert(value: unknown, message = "Assertion failed") { if (!value) throw new Error(message); }
const userId = "fa280000-0000-4000-8000-000000000001";
function event(action: string) { return { user: { id: userId, email: "member@example.test", new_email: "new@example.test" },
  email_data: { email_action_type: action, token: "123456", token_new: "654321", token_hash: "a".repeat(64) } }; }
const origin = "https://fixture.supabase.co";
for (const action of ["signup", "magiclink", "recovery", "reauthentication"]) Deno.test(`${action} retains the code email, not a welcome/security message`, () => {
  const email = renderAuthEmails(event(action), origin)[0];
  assert(email.to === "member@example.test" && email.text.includes("123456") && email.text.includes("10 minutes"));
  assert(!email.subject.includes("Welcome") && !email.subject.includes("changed"));
});
Deno.test("welcome and password-change notices are separate messages", () => {
  const welcome = welcomeEmail("member@example.test"), security = renderAuthEmails(event("password_changed_notification"), origin)[0];
  assert(welcome.subject === "Welcome to Hidden Plate" && !welcome.text.includes("123456"));
  assert(security.subject.includes("password was changed") && !security.subject.includes("Welcome") && !security.text.includes("123456"));
});
Deno.test("secure email change maps both codes to the correct recipients", () => {
  const payload = event("email_change"); Object.assign(payload.email_data, { token_hash_new: "b".repeat(64) });
  const emails = renderAuthEmails(payload, origin);
  assert(emails.length === 2 && emails[0].to === "member@example.test" && emails[0].text.includes("123456"));
  assert(emails[1].to === "new@example.test" && emails[1].text.includes("654321"));
});
Deno.test("single email change sends only to the new address", () => {
  const payload = event("email_change"); payload.email_data.token_new = "";
  const emails = renderAuthEmails(payload, origin);
  assert(emails.length === 1 && emails[0].to === "new@example.test" && emails[0].text.includes("123456"));
});
Deno.test("email-change security notice also reaches the old address", () => {
  const payload = event("email_changed_notification"); Object.assign(payload.email_data, { old_email: "old@example.test" });
  const emails = renderAuthEmails(payload, origin);
  assert(emails.length === 2 && emails[1].to === "old@example.test");
});
for (const action of ["phone_changed_notification", "identity_linked_notification", "identity_unlinked_notification", "mfa_factor_enrolled_notification", "mfa_factor_unenrolled_notification", "invite"]) Deno.test(`preserves ${action} support`, () => {
  assert(renderAuthEmails(event(action), origin).length === 1);
});
Deno.test("invalid recipient/code/action are rejected instead of sending arbitrary content", () => {
  for (const payload of [event("unknown"), { ...event("signup"), user: { id: userId, email: "bad\n@example.test" } },
    { ...event("signup"), email_data: { email_action_type: "signup", token: "<script>" } }]) {
    let rejected = false; try { renderAuthEmails(payload, origin); } catch { rejected = true; } assert(rejected);
  }
  assert(authEmailEvent(event("signup")).userId === userId);
});

const webhook = new Webhook(btoa("fixture-signing-key-not-a-real-secret"));
async function request(payload: unknown, signed = true) {
  const body = JSON.stringify(payload), timestamp = new Date();
  const signature = await webhook.sign("msg_test", timestamp, body);
  return new Request("https://fixture.test", { method: "POST", body,
    headers: { "webhook-id": "msg_test", "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "webhook-signature": signed ? signature : "v1,invalid" } });
}
function dependencies(pending = false) {
  const sent: EmailMessage[] = [], decisions: string[] = [];
  return { sent, decisions, deps: {
    projectUrl: origin, verify: (body: string, headers: Record<string, string>) => webhook.verify(body, headers),
    classifyPasswordEmail: async (id: string, user: string, hash: string) => { decisions.push(`${id}:${user}:${hash.length}`); return pending; },
    send: async (email: EmailMessage, key: string) => { assert(key === "auth/msg_test/0"); sent.push(email); },
  } };
}
Deno.test("real valid webhook suppresses pending-signup password alert only", async () => {
  const { sent, decisions, deps } = dependencies(true);
  assert((await handleAuthEmail(await request(event("password_changed_notification")), deps)).status === 200);
  assert(sent.length === 0 && decisions.length === 1);
  assert((await handleAuthEmail(await request(event("recovery")), deps)).status === 200);
  assert(Number(sent.length) === 1 && decisions.length === 1);
});
Deno.test("completed-account password changes still send the security notice", async () => {
  const { sent, deps } = dependencies(false);
  assert((await handleAuthEmail(await request(event("password_changed_notification")), deps)).status === 200);
  assert(sent.length === 1 && sent[0].subject.includes("password was changed"));
});
Deno.test("invalid signature cannot read signup state or send email", async () => {
  const { sent, decisions, deps } = dependencies(true);
  assert((await handleAuthEmail(await request(event("password_changed_notification"), false), deps)).status === 401);
  assert(sent.length === 0 && decisions.length === 0);
});
Deno.test("database/provider failures fail closed without exposing their details", async () => {
  const { deps } = dependencies();
  const failed = await handleAuthEmail(await request(event("password_changed_notification")), { ...deps,
    classifyPasswordEmail: () => Promise.reject(new Error("private-database-details")) });
  assert(failed.status === 503 && !(await failed.text()).includes("private-database-details"));
  const sendFailed = await handleAuthEmail(await request(event("signup")), { ...deps,
    send: () => Promise.reject(new Error("private-provider-details")) });
  assert(sendFailed.status === 503 && !(await sendFailed.text()).includes("private-provider-details"));
});
Deno.test("body cap and methods reject before signature work", async () => {
  const { deps } = dependencies();
  assert((await handleAuthEmail(new Request("https://fixture.test"), deps)).status === 405);
  assert((await handleAuthEmail(new Request("https://fixture.test", { method: "POST", body: "x".repeat(32769) }), deps)).status === 413);
});
Deno.test("provider request uses idempotency and never accepts a failed/missing-id response", async () => {
  let called = false;
  await sendResendEmail("fixture-key", "Hidden Plate <noreply@example.test>", welcomeEmail("member@example.test"), "welcome/fixture", async (url, options) => {
    called = true; assert(url === "https://api.resend.com/emails");
    assert(new Headers(options?.headers).get("Idempotency-Key") === "welcome/fixture");
    return Response.json({ id: "provider-message" });
  }); assert(called);
  for (const result of [Response.json({}, { status: 429 }), Response.json({})]) {
    let failed = false;
    try { await sendResendEmail("key", "sender", welcomeEmail("member@example.test"), "welcome/fixture", async () => result); } catch { failed = true; }
    assert(failed);
  }
});
