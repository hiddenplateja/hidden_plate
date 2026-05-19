// src/services/saved.ts
// Save restaurants to user-defined lists: favorite, want_to_go, visited.
//
// Data model:
//   One document per (userId, restaurantId, listType) combination.
//   The unique compound index prevents duplicates at the DB level.
//
// Privacy:
//   Document Security is ON. Per-document permissions set to the owning user
//   only — nobody else can read your saves.
//
// "visited" and "want_to_go" are mutually exclusive — adding to one removes
//   the other, matching the UX convention from the old app.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import type { Restaurant } from "@/types/restaurant";

export type ListType = "favorite" | "want_to_go" | "visited";

export interface SavedDoc {
  id: string;
  userId: string;
  restaurantId: string;
  listType: ListType;
  /** When the save was created (ISO string). Used for "Newest saved" sort. */
  createdAt: string;
}

export class SavedError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "SavedError";
  }
}

interface RawSavedDoc {
  $id: string;
  $createdAt: string;
  userId: string;
  restaurantId: string;
  listType: ListType;
}

function mapDoc(doc: RawSavedDoc): SavedDoc {
  return {
    id: doc.$id,
    userId: doc.userId,
    restaurantId: doc.restaurantId,
    listType: doc.listType,
    createdAt: doc.$createdAt,
  };
}

/**
 * Get the current user's save status for a restaurant.
 * Returns a map of listType → doc ID (or null if not saved in that list).
 * Use this to initialize the save buttons on the detail screen.
 */
export async function getSavedStatus(
  restaurantId: string,
): Promise<Record<ListType, string | null>> {
  const status: Record<ListType, string | null> = {
    favorite: null,
    want_to_go: null,
    visited: null,
  };

  let me;
  try {
    me = await account.get();
  } catch {
    return status;
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.saved,
      [
        Query.equal("userId", me.$id),
        Query.equal("restaurantId", restaurantId),
        Query.limit(3),
      ],
    );
    for (const doc of res.documents) {
      const d = doc as unknown as RawSavedDoc;
      if (d.listType in status) {
        status[d.listType] = d.$id;
      }
    }
  } catch (err) {
    console.warn("[saved] getSavedStatus failed:", err);
  }
  return status;
}

/**
 * Toggle a restaurant in/out of a list.
 * Returns the new status map after the operation.
 *
 * Business rules:
 *   - visited and want_to_go are mutually exclusive.
 *     Adding visited removes want_to_go, and vice versa.
 *   - favorite is independent — can be combined with either.
 */
export async function toggleSaved(
  restaurantId: string,
  listType: ListType,
  currentStatus: Record<ListType, string | null>,
): Promise<Record<ListType, string | null>> {
  let me;
  try {
    me = await account.get();
  } catch {
    throw new SavedError("You must be signed in.");
  }

  const next = { ...currentStatus };
  const existingId = currentStatus[listType];

  try {
    if (existingId) {
      // Already saved in this list — remove it
      await databases.deleteDocument(
        appwriteConfig.databaseId,
        appwriteConfig.collections.saved,
        existingId,
      );
      next[listType] = null;
    } else {
      // Add to this list
      const doc = await databases.createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.collections.saved,
        ID.unique(),
        {
          userId: me.$id,
          restaurantId,
          listType,
        },
        [
          Permission.read(Role.user(me.$id)),
          Permission.update(Role.user(me.$id)),
          Permission.delete(Role.user(me.$id)),
        ],
      );
      next[listType] = doc.$id;

      // Enforce mutual exclusion between visited and want_to_go
      if (listType === "visited" && next.want_to_go) {
        await databases.deleteDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.saved,
          next.want_to_go,
        );
        next.want_to_go = null;
      } else if (listType === "want_to_go" && next.visited) {
        await databases.deleteDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.saved,
          next.visited,
        );
        next.visited = null;
      }
    }
  } catch (err) {
    if (err instanceof AppwriteException) {
      throw new SavedError(err.message || "Failed to update saved list.");
    }
    throw new SavedError("Failed to update saved list.");
  }
  return next;
}

/**
 * List all saved restaurants for the current user, optionally filtered by
 * list type. Used by the profile tab's "Saved" sub-section.
 *
 * Returns newest-saved first (sorted by $createdAt desc).
 */
export async function listSavedByUser(
  listType?: ListType,
): Promise<SavedDoc[]> {
  let me;
  try {
    me = await account.get();
  } catch {
    return [];
  }

  const queries: string[] = [
    Query.equal("userId", me.$id),
    Query.orderDesc("$createdAt"),
    Query.limit(200),
  ];
  if (listType) queries.push(Query.equal("listType", listType));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.saved,
      queries,
    );
    return (res.documents as unknown as RawSavedDoc[]).map(mapDoc);
  } catch (err) {
    console.warn("[saved] listSavedByUser failed:", err);
    return [];
  }
}

/**
 * Get the current user's saved restaurants in a specific list, fully hydrated.
 * Returns pairs of (saved doc, restaurant), sorted by save time descending.
 *
 * Missing restaurants (deleted from the platform) are returned with
 * restaurant=null so the UI can render a "Currently unavailable" state.
 */
export async function listSavedRestaurants(
  listType: ListType,
): Promise<{ saved: SavedDoc; restaurant: Restaurant | null }[]> {
  const savedDocs = await listSavedByUser(listType);
  if (savedDocs.length === 0) return [];

  // Import inline to avoid circular dependency at module load
  const { getRestaurantsByIds } = await import("@/services/restaurants");
  const restaurantMap = await getRestaurantsByIds(
    savedDocs.map((s) => s.restaurantId),
  );

  return savedDocs.map((saved) => ({
    saved,
    restaurant: restaurantMap.get(saved.restaurantId) ?? null,
  }));
}

/**
 * Count the number of restaurants the current user has saved across all
 * list types. Used in profile stats.
 *
 * Note: this only works for the *current* user's own counts. Other users'
 * saves are private (per-doc Read permission) and can't be counted by anyone
 * else — which is by design.
 */
export async function getMySavedCount(): Promise<number> {
  let me;
  try {
    me = await account.get();
  } catch {
    return 0;
  }
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.saved,
      [Query.equal("userId", me.$id), Query.limit(1)],
    );
    // total is the count, not the array length
    return res.total;
  } catch (err) {
    console.warn("[saved] getMySavedCount failed:", err);
    return 0;
  }
}
