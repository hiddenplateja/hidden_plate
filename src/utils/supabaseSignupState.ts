/** PostgREST embeds the one-to-one pending row as an object or null. */
export type SupabaseSignupPending = { user_id: string } | { user_id: string }[] | null;

export function hasPendingSupabaseSignup(value: unknown, userId: string): boolean {
  if (value === null) return false;
  // Accept older array-shaped responses too, without treating malformed or
  // another account's pending record as a completed signup.
  const rows = Array.isArray(value) ? value : [value];
  if (rows.length > 1 || rows.some(row => !row || typeof row !== "object" || row.user_id !== userId)) {
    throw new Error("Couldn't read your signup status. Please sign in again.");
  }
  return rows.length > 0;
}
