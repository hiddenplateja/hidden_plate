// src/services/blocks.ts
// Block/unblock data layer. Blocking is MUTUAL: once A blocks B, neither
// sees the other's reviews, comments, or feed items.
//
// One row per block (collection: blocks) — { blockerId, blockedId }.
// Unblock = delete the row. There's no "unblock someone who blocked you":
// you can only delete blocks you created.
//
// Permissions (set per-document on create):
//   - read:   Role.users()  → any signed-in user can read block rows.
//   - delete: the blocker only.
//
//   Why read = users() rather than "just the two participants": the client
//   SDK only lets a user grant document permissions to roles that include
//   THEMSELVES (any / users / user:<self>). It cannot grant read to another
//   specific user, so there's no client-only way to scope a row to exactly
//   the blocker + blocked pair. For mutual filtering to work, the blocked
//   user must be able to read rows where they're the target — hence users().
//   Tradeoff: block relationships are readable at the API level by any
//   signed-in user (the app never surfaces anyone else's blocks). To make
//   this private, move block creation into a Cloud Function that runs with
//   an API key and can scope read to the two specific users.
//
// Error handling philosophy mirrors reviews.ts:
//   - blockUser / unblockUser / listBlockedUsers THROW. They're driven by a
//     user action or a management screen that needs an error UI.
//   - getHiddenUserIds / isBlocked stay TOLERANT (return empty/false on
//     failure, with a Sentry report). A failed hidden-set lookup degrades to
//     "show everything" rather than breaking the feed.
//
// Note: getHiddenUserIds uses Query.or, which requires a reasonably recent
// Appwrite SDK (fine on the current react-native-appwrite version).

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { captureError } from "@/services/sentry";
import { getUserById } from "@/services/users";
import type { User } from "@/types/user";

const COLLECTION = appwriteConfig.collections.blocks;

// Generous cap — no realistic user blocks thousands of accounts. Matches the
// "fetch all of X" pattern used by the stat helpers in reviews.ts.
const MAX_BLOCKS = 5000;

// ---------- Errors ----------

export class BlockError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "BlockError";
  }
}

function toBlockError(err: unknown, fallback: string): BlockError {
  if (err instanceof AppwriteException) {
    return new BlockError(err.message || fallback, err.type);
  }
  return new BlockError(fallback);
}

// ---------- Mapping ----------

interface BlockDoc {
  $id: string;
  $createdAt: string;
  blockerId: string;
  blockedId: string;
}

// ---------- Internal helpers ----------

async function requireMe(): Promise<string> {
  try {
    const me = await account.get();
    return me.$id;
  } catch {
    throw new BlockError("You must be signed in to do that.");
  }
}

/** Find the block row (blockerId = me, blockedId = target), or null. */
async function findMyBlock(
  meId: string,
  targetId: string,
): Promise<BlockDoc | null> {
  const res = await databases.listDocuments(
    appwriteConfig.databaseId,
    COLLECTION,
    [
      Query.equal("blockerId", meId),
      Query.equal("blockedId", targetId),
      Query.limit(1),
    ],
  );
  return (res.documents[0] as unknown as BlockDoc) ?? null;
}

// ---------- Public API ----------

/** Current user blocks targetId. Idempotent — no-op if already blocked. */
export async function blockUser(targetId: string): Promise<void> {
  const meId = await requireMe();
  if (meId === targetId) {
    throw new BlockError("You can't block yourself.");
  }
  try {
    const existing = await findMyBlock(meId, targetId);
    if (existing) return; // already blocked

    await databases.createDocument(
      appwriteConfig.databaseId,
      COLLECTION,
      ID.unique(),
      { blockerId: meId, blockedId: targetId },
      [
        // Readable by any signed-in user (so the blocked side can compute
        // its hidden set); deletable only by the blocker. See file header.
        Permission.read(Role.users()),
        Permission.delete(Role.user(meId)),
      ],
    );
  } catch (err) {
    captureError(err, { service: "blocks", op: "blockUser", targetId });
    throw toBlockError(err, "Couldn't block this user.");
  }
}

/** Current user unblocks targetId. Idempotent — no-op if not blocked. */
export async function unblockUser(targetId: string): Promise<void> {
  const meId = await requireMe();
  try {
    const existing = await findMyBlock(meId, targetId);
    if (!existing) return; // already not blocked

    await databases.deleteDocument(
      appwriteConfig.databaseId,
      COLLECTION,
      existing.$id,
    );
  } catch (err) {
    captureError(err, { service: "blocks", op: "unblockUser", targetId });
    throw toBlockError(err, "Couldn't unblock this user.");
  }
}

/**
 * The set of user IDs the current user shouldn't see (and who shouldn't see
 * them) — the UNION of "people I blocked" and "people who blocked me". Use
 * this to filter feeds, review lists, comments, etc.
 *
 * Tolerant: returns an empty set on failure (with Sentry). A failed lookup
 * means content isn't filtered rather than the feed breaking.
 */
export async function getHiddenUserIds(): Promise<Set<string>> {
  const hidden = new Set<string>();

  let meId: string;
  try {
    const me = await account.get();
    meId = me.$id;
  } catch {
    return hidden; // signed out — nothing to hide
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      COLLECTION,
      [
        Query.or([
          Query.equal("blockerId", meId),
          Query.equal("blockedId", meId),
        ]),
        Query.limit(MAX_BLOCKS),
      ],
    );

    for (const doc of res.documents as unknown as BlockDoc[]) {
      const other = doc.blockerId === meId ? doc.blockedId : doc.blockerId;
      hidden.add(other);
    }
    return hidden;
  } catch (err) {
    captureError(err, { service: "blocks", op: "getHiddenUserIds" });
    return hidden;
  }
}

/**
 * Whether the current user has blocked targetId — drives the Block/Unblock
 * toggle on a profile. Tolerant: returns false on failure (with Sentry).
 */
export async function isBlocked(targetId: string): Promise<boolean> {
  let meId: string;
  try {
    const me = await account.get();
    meId = me.$id;
  } catch {
    return false;
  }

  try {
    const existing = await findMyBlock(meId, targetId);
    return existing !== null;
  } catch (err) {
    captureError(err, { service: "blocks", op: "isBlocked", targetId });
    return false;
  }
}

/**
 * Hydrated list of users the current user has blocked — for the "Blocked
 * Users" settings screen. Only blocks YOU created (so you can unblock them),
 * not people who blocked you. Most-recent first.
 *
 * Throws on failure — the management screen renders an error UI. Individual
 * user lookups go through allSettled so one deleted account doesn't drop the
 * whole list.
 */
export async function listBlockedUsers(): Promise<User[]> {
  const meId = await requireMe();

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      COLLECTION,
      [
        Query.equal("blockerId", meId),
        Query.orderDesc("$createdAt"),
        Query.limit(MAX_BLOCKS),
      ],
    );

    const ids = (res.documents as unknown as BlockDoc[]).map(
      (d) => d.blockedId,
    );

    const settled = await Promise.allSettled(ids.map((id) => getUserById(id)));
    const users: User[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) users.push(r.value);
    }
    return users;
  } catch (err) {
    captureError(err, { service: "blocks", op: "listBlockedUsers" });
    throw toBlockError(err, "Couldn't load your blocked users.");
  }
}