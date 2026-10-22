export type EmailMessage = { to: string; subject: string; html: string; text: string };
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid email event");
  return value as RecordValue;
}
function address(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)) throw new Error("Invalid email address");
  return value;
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
function message(to: string, subject: string, text: string): EmailMessage {
  return { to, subject, text, html: `<h2>${escape(subject)}</h2>${text.split("\n\n").map(p => `<p>${escape(p)}</p>`).join("")}` };
}
export function authEmailEvent(payload: unknown) {
  const event = object(payload), user = object(event.user), data = object(event.email_data);
  if (typeof user.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) throw new Error("Invalid email user");
  if (typeof data.email_action_type !== "string") throw new Error("Invalid email action");
  return { userId: user.id, email: address(user.email), action: data.email_action_type, data, user };
}
export function renderAuthEmails(payload: unknown, projectUrl: string): EmailMessage[] {
  const { email, action, data, user } = authEmailEvent(payload);
  const code = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{6}$/.test(value)) throw new Error("Invalid verification code");
    return value;
  };
  const otp = (to: string, title: string, value: unknown) => message(to, title,
    `Enter this code in Hidden Plate: ${code(value)}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nIf you did not request this code, you can ignore this email.`);
  if (action === "signup") return [otp(email, "Verify your Hidden Plate email", data.token)];
  if (action === "magiclink") return [otp(email, "Your Hidden Plate verification code", data.token)];
  if (action === "recovery") return [otp(email, "Reset your Hidden Plate password", data.token)];
  if (action === "reauthentication") return [otp(email, "Your Hidden Plate security code", data.token)];
  if (action === "email_change") {
    const next = address(user.new_email);
    // Secure Email Change: token goes to current address; token_new to new.
    if (data.token_hash && data.token_hash_new) return [
      otp(email, "Confirm your Hidden Plate email change", data.token),
      otp(next, "Confirm your new Hidden Plate email", data.token_new),
    ];
    return [otp(next, "Confirm your new Hidden Plate email", data.token_new || data.token)];
  }
  if (action === "invite") {
    if (typeof data.token_hash !== "string" || !/^[a-zA-Z0-9_-]{20,256}$/.test(data.token_hash)) throw new Error("Invalid invitation");
    const origin = new URL(projectUrl).origin;
    if (new URL(origin).protocol !== "https:") throw new Error("Invalid project origin");
    const link = `${origin}/auth/v1/verify?type=invite&token=${encodeURIComponent(data.token_hash)}`;
    const invitation = message(email, "You are invited to Hidden Plate", `Accept your invitation: ${link}\n\nIf you were not expecting this invitation, ignore this email.`);
    invitation.html += `<p><a href="${escape(link)}">Accept invitation</a></p>`;
    return [invitation];
  }
  const security: Record<string, string> = {
    password_changed_notification: "Your Hidden Plate password was changed",
    email_changed_notification: "Your Hidden Plate email address was changed",
    phone_changed_notification: "Your Hidden Plate phone number was changed",
    identity_linked_notification: "A sign-in method was linked to your Hidden Plate account",
    identity_unlinked_notification: "A sign-in method was removed from your Hidden Plate account",
    mfa_factor_enrolled_notification: "A verification method was added to your Hidden Plate account",
    mfa_factor_unenrolled_notification: "A verification method was removed from your Hidden Plate account",
  };
  if (security[action]) {
    const recipients = new Set([email]);
    if (action === "email_changed_notification" && data.old_email) recipients.add(address(data.old_email));
    return [...recipients].map(to => message(to, security[action],
      "This is a security notification for your Hidden Plate account.\n\nIf you made this change, no action is needed. If you did not, reset your password in the app and contact support."));
  }
  throw new Error("Unsupported email action");
}
export function welcomeEmail(to: string): EmailMessage {
  return message(address(to), "Welcome to Hidden Plate", "Your Hidden Plate account is ready!\n\nDiscover restaurants, save places you want to try, and share your food experiences with the community.\n\nThanks for joining us. Open the Hidden Plate app to get started.");
}
export async function sendResendEmail(apiKey: string, from: string, email: EmailMessage, idempotencyKey: string, transport: typeof fetch = fetch): Promise<void> {
  if (!apiKey || !from || /[\r\n]/.test(from)) throw new Error("Email sender is not configured");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await transport("https://api.resend.com/emails", { method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }) });
    if (!response.ok) throw new Error("Email provider rejected request");
    const result = await response.json();
    if (typeof result.id !== "string" || !result.id) throw new Error("Email provider did not accept request");
  } finally { clearTimeout(timer); }
}
