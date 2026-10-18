// Staged profile adapter. Public reads never fetch auth email, role or preferences.
import { supabase } from "@/services/supabase";
import { assertSupabaseSessionCurrent, pinSupabaseSession } from "@/services/supabasePinnedSession";
import { requestSupabaseRpc } from "@/services/supabaseDataRequest";
import type { UpdateProfileInput, User } from "@/types/user";
import { validateAuthProfile } from "@/utils/authValidation";
import { getSupabaseImageUrl } from "@/services/supabaseMediaUrls";

export class SupabaseUserError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "SupabaseUserError";
  }
}

export type SupabasePublicProfile = {
  id: string; username: string; display_name: string; avatar_path: string | null;
  bio: string | null; created_at: string; is_banned: boolean;
};
const PUBLIC_COLUMNS = "id,username,display_name,avatar_path,bio,created_at,is_banned";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapSupabasePublicProfile(row: SupabasePublicProfile): User {
  return { id: row.id, email: "", username: row.username, displayName: row.display_name,
    avatarUrl: getSupabaseImageUrl(row.avatar_path), bio: row.bio, createdAt: row.created_at, isBanned: row.is_banned };
}
type PublicProfile=SupabasePublicProfile;
const mapProfile=mapSupabasePublicProfile;
function fail(error: { message: string; code?: string } | null, fallback: string): never {
  throw new SupabaseUserError(error?.code === "23505" ? "That username is already taken." : error?.message ?? fallback, error?.code);
}
function boundedLimit(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.trunc(value))) : fallback;
}
function validateProfile(username: string, name: string): void {
  try { validateAuthProfile(username, name); }
  catch (error) { throw new SupabaseUserError(error instanceof Error ? error.message : "Check your profile."); }
}
/** Chunk large batches below the API row cap; preserve the existing missing-user contract. */
export async function getSupabaseUsersByIds(ids: string[]): Promise<Map<string, User>> {
  const unique = [...new Set(ids.filter((id) => UUID.test(id)))];
  const users = new Map<string, User>();
  try {
    for (let start = 0; start < unique.length; start += 100) {
      const { data, error } = await supabase.from("public_profiles").select(PUBLIC_COLUMNS)
        .in("id", unique.slice(start, start + 100));
      if (error) fail(error, "Failed to load users.");
      for (const row of (data ?? []) as PublicProfile[]) users.set(row.id, mapProfile(row));
    }
    return users;
  } catch {
    // Match the live tolerant reader without logging private backend details.
    return new Map();
  }
}

export async function getSupabaseUserById(id: string): Promise<User | null> {
  if (!UUID.test(id)) return null;
  try {
    const { data, error } = await supabase.from("public_profiles").select(PUBLIC_COLUMNS).eq("id", id).maybeSingle();
    return error || !data ? null : mapProfile(data as PublicProfile);
  } catch { return null; }
}

export async function listSupabaseUsers(opts: { cursor?: string | null; pageSize?: number } = {}): Promise<{
  items: User[]; nextCursor: string | null; hasMore: boolean;
}> {
  const pageSize = boundedLimit(opts.pageSize ?? 30, 30);
  if (opts.cursor && !UUID.test(opts.cursor)) throw new SupabaseUserError("Invalid user cursor. Refresh the list.");
  const { data, error } = await requestSupabaseRpc("admin_list_profiles", { after_id: opts.cursor ?? null, page_size: pageSize });
  if (error) fail(error, "Couldn't load users.");
  const rows = (data ?? []) as PublicProfile[];
  const items = rows.slice(0, pageSize).map(mapProfile);
  return { items, hasMore: rows.length > pageSize, nextCursor: items.at(-1)?.id ?? null };
}

export async function setSupabaseUserBanned(id: string, banned: boolean): Promise<void> {
  if (!UUID.test(id) || typeof banned !== "boolean") throw new SupabaseUserError("Invalid user update.");
  const { error } = await requestSupabaseRpc("admin_set_user_banned", { target_id: id, banned });
  if (error) fail(error, "Couldn't update the user.");
}

export async function updateMySupabaseProfile(input: UpdateProfileInput): Promise<User> {
  const pinned = await pinSupabaseSession();
  if (!pinned) throw new SupabaseUserError("You must be signed in. Your account may have changed.");
  // Whitelist fields even when a JS caller passes keys outside the TS interface.
  const patch: Record<string, string | null> = {};
  if (input.username !== undefined) {
    const username = input.username.trim().toLowerCase();
    // Share the signup policy; display name is independently validated below.
    validateProfile(username, "Valid name");
    patch.username = username;
  }
  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim();
    validateProfile("valid_user", displayName);
    patch.display_name = displayName;
  }
  if (input.bio !== undefined) {
    if (input.bio !== null && (typeof input.bio !== "string" || input.bio.length > 280)) {
      throw new SupabaseUserError("Bio must be 280 characters or less");
    }
    patch.bio = input.bio;
  }
  if (input.avatarUrl !== undefined) patch.avatar_path = input.avatarUrl;
  await assertSupabaseSessionCurrent(pinned);
  const { data, error } = await pinned.client.rpc("update_my_profile", { profile_patch: patch })
    .setHeader("Authorization", `Bearer ${pinned.accessToken}`);
  await assertSupabaseSessionCurrent(pinned);
  if (error) fail(error, "Failed to update profile.");
  const row = (data as PublicProfile[] | null)?.[0];
  if (!row || row.id !== pinned.userId) throw new SupabaseUserError("Couldn't load your updated profile.");
  return mapProfile(row);
}

export async function searchSupabaseUsers(rawQuery: string): Promise<User[]> {
  const query = rawQuery.trim().replace(/^@/, "");
  if (query.length < 2) return [];
  if (query.length > 100) return [];
  try {
    const { data, error } = await requestSupabaseRpc("search_public_profiles", { search_text: query });
    return error ? [] : ((data ?? []) as PublicProfile[]).map(mapProfile);
  } catch { return []; }
}

export async function getSupabaseSuggestedUsers(limit = 10): Promise<User[]> {
  try {
    const { data, error } = await requestSupabaseRpc("suggest_public_profiles", { result_limit: boundedLimit(limit, 10) });
    return error ? [] : ((data ?? []) as PublicProfile[]).map(mapProfile);
  } catch { return []; }
}
