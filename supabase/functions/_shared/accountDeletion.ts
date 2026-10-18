// No target ID from an HTTP body ever reaches these privileged operations.
type Result = { data: unknown; error: unknown };
export type DeletionAdmin = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<Result>;
  auth: { admin: { deleteUser(id: string, soft?: boolean): Promise<{
    error: { status?: number; code?: string } | null;
  }> } };
};

export async function prepareDeletion(db: DeletionAdmin, userId: string) {
  const { error } = await db.rpc("prepare_account_deletion", { target_user: userId });
  if (error) throw new Error("Could not prepare deletion.");
}

export async function finishDeletion(db: DeletionAdmin, userId: string) {
  // Failures leave a private, already-prepared job for the caller/worker retry.
  const { error } = await db.auth.admin.deleteUser(userId, false);
  if (error && error.code !== "user_not_found" && error.status !== 404) {
    throw new Error("Auth deletion needs retry.");
  }
  // The database verifies the Auth row is gone; a generic 404 is not proof.
  const { data, error: finalError } = await db.rpc("complete_account_deletion", { target_user: userId });
  if (finalError || !data) throw new Error("Deletion confirmation needs retry.");
  return data;
}

export async function isEmptyDeletionRequest(req: Request): Promise<boolean> {
  if (Number(req.headers.get("content-length") ?? 0) > 1024) return false;
  const raw = await req.text();
  if (raw.length > 1024) return false;
  try {
    const body = JSON.parse(raw);
    return body !== null && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
  } catch { return false; }
}
