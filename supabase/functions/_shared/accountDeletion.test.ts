import { finishDeletion, isEmptyDeletionRequest, prepareDeletion, type DeletionAdmin } from "./accountDeletion.ts";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
function mock(authError: { status?: number; code?: string } | null = null, finalError: unknown = null) {
  const calls: string[] = [];
  const db: DeletionAdmin = {
    rpc(name, args) { calls.push(`${name}:${args?.target_user}`); return Promise.resolve({ data: { authAccountDeleted: true }, error: name === "complete_account_deletion" ? finalError : null }); },
    auth: { admin: { deleteUser(id, soft) { calls.push(`auth:${id}:${soft}`); return Promise.resolve({ error: authError }); } } },
  }; return { db, calls };
}
Deno.test("prepare then hard-delete Auth then confirm; no payload identity", async () => {
  const { db, calls } = mock(); await prepareDeletion(db, "verified-caller"); await finishDeletion(db, "verified-caller");
  assert(calls.join(",") === "prepare_account_deletion:verified-caller,auth:verified-caller:false,complete_account_deletion:verified-caller", "Wrong operation order");
});
Deno.test("Auth failure does not falsely finalize", async () => {
  const { db, calls } = mock({ status: 500 }); let failed = false;
  try { await finishDeletion(db, "caller"); } catch { failed = true; }
  assert(failed && calls.length === 1, "Failure was treated as success");
});
Deno.test("retry after Auth deletion confirms through database", async () => {
  const { db, calls } = mock({ code: "user_not_found" }); await finishDeletion(db, "caller");
  assert(calls.length === 2, "Lost-response retry not finalized");
});
Deno.test("404 is not success without database proof", async () => {
  const { db } = mock({ status: 404 }, new Error("Auth still exists")); let failed = false;
  try { await finishDeletion(db, "caller"); } catch { failed = true; }
  assert(failed, "Unverified 404 accepted");
});
Deno.test("only an empty object is accepted by self-deletion endpoint", async () => {
  for (const body of ['{"user_id":"victim"}', '{"retry":true}', "[]", "null", "", "invalid", '"string"', " ".repeat(1025)]) {
    assert(!await isEmptyDeletionRequest(new Request("https://example.test", { method: "POST", body })), `Unsafe body accepted: ${body.slice(0, 30)}`);
  }
  assert(await isEmptyDeletionRequest(new Request("https://example.test", { method: "POST", body: "{}" })), "Empty object rejected");
});
