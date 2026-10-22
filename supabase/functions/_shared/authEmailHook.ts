import { authEmailEvent, renderAuthEmails, type EmailMessage } from "./authEmails.ts";
type Dependencies = {
  verify: (body: string, headers: Record<string, string>) => unknown;
  classifyPasswordEmail: (eventId: string, userId: string, hash: string) => Promise<boolean>;
  send: (message: EmailMessage, key: string) => Promise<void>;
  projectUrl: string;
};
export async function handleAuthEmail(req: Request, deps: Dependencies): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  let raw = "", payload: unknown;
  const reader = req.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 32768) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    raw = new TextDecoder().decode(bytes);
    payload = deps.verify(raw, Object.fromEntries(req.headers));
  } catch { return Response.json({ error: "Invalid email hook signature" }, { status: 401 }); }
  finally { reader.releaseLock(); }
  try {
    const id = req.headers.get("webhook-id");
    if (!id || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(id)) return new Response(null, { status: 400 });
    const event = authEmailEvent(payload);
    if (event.action === "password_changed_notification") {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
      const hash = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
      if (await deps.classifyPasswordEmail(id, event.userId, hash)) return Response.json({});
    }
    await Promise.all(renderAuthEmails(payload, deps.projectUrl).map((email, index) => deps.send(email, `auth/${id}/${index}`)));
    return Response.json({});
  } catch {
    // No payloads/OTPs/email addresses/provider details in logs or responses.
    return Response.json({ error: "Email could not be sent" }, { status: 503 });
  }
}
