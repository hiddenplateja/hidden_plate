// SDK-free, in-memory transition counter. Tickets contain no credentials.
// The shared client's synchronous auth observer records changes; data services
// never reset this counter, including across sign-out -> sign-in as the same user.
let revision = 0;
let userId: string | null = null;
let accessToken: string | null = null;
export function recordSupabaseSession(session: { user: { id: string }; access_token: string } | null): void {
  const nextId = session?.user.id ?? null, nextToken = session?.access_token ?? null;
  if (nextId !== userId || nextToken !== accessToken) revision++;
  userId = nextId; accessToken = nextToken;
}
export function captureSupabaseSessionRevision(): number { return revision; }
export function captureSupabaseActionIdentity(): { userId: string | null; revision: number } {
  return { userId, revision };
}
export function assertSupabaseSessionRevision(expected: number): void {
  if (expected !== revision) throw new Error("Your session changed. Please try again.");
}
