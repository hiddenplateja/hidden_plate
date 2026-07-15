// src/services/lists.ts
// User-curated "Collections" of restaurants.
//
// Data model:
//   One document per list. The restaurants are an ordered array of ids
//   (`restaurantIds`) ON the doc — no join collection. A list's visibility is
//   therefore just the document's READ permission:
//     - private → read/update/delete = owner only
//     - public  → read = any signed-in user, write = owner
//   Flipping `isPublic` swaps the read role in one updateDocument call.
//
// Gating:
//   The whole feature no-ops until EXPO_PUBLIC_APPWRITE_LISTS_COLLECTION_ID is
//   set (listsEnabled()). Screens check this before surfacing list UI.
//
// Errors:
//   Read/write paths throw ListError so screens can show an error state; all
//   failures report to Sentry regardless.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { captureError } from "@/services/sentry";
import type { CreateListInput, List, UpdateListInput } from "@/types/list";
import type { Restaurant } from "@/types/restaurant";
import {
  addRestaurantId,
  removeRestaurantId,
  resolveCoverId,
} from "@/utils/listEditing";

export class ListError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ListError";
  }
}

/** True once the lists collection id is configured. */
export function listsEnabled(): boolean {
  return !!appwriteConfig.collections.lists;
}

function collectionId(): string {
  const id = appwriteConfig.collections.lists;
  if (!id) throw new ListError("Collections aren't enabled yet.");
  return id;
}

interface RawListDoc {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  ownerId: string;
  title: string;
  description?: string | null;
  isPublic?: boolean;
  restaurantIds?: string[];
  coverRestaurantId?: string | null;
}

function mapDoc(doc: RawListDoc): List {
  return {
    id: doc.$id,
    ownerId: doc.ownerId,
    title: doc.title,
    description: doc.description ?? null,
    isPublic: !!doc.isPublic,
    restaurantIds: doc.restaurantIds ?? [],
    coverRestaurantId: doc.coverRestaurantId ?? null,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
  };
}

// Read = any signed-in user when public; owner always read/write/delete.
function permsFor(isPublic: boolean, ownerId: string): string[] {
  const owner = [
    Permission.read(Role.user(ownerId)),
    Permission.update(Role.user(ownerId)),
    Permission.delete(Role.user(ownerId)),
  ];
  return isPublic ? [Permission.read(Role.users()), ...owner] : owner;
}

async function requireMe(): Promise<string> {
  try {
    const me = await account.get();
    return me.$id;
  } catch {
    throw new ListError("You must be signed in.");
  }
}

function toListError(err: unknown, fallback: string): ListError {
  if (err instanceof ListError) return err;
  if (err instanceof AppwriteException) {
    return new ListError(err.message || fallback, err.type);
  }
  return new ListError(fallback);
}

/** Fetch one list (works for public lists owned by anyone, or your own). */
export async function getList(id: string): Promise<List> {
  try {
    const doc = await databases.getDocument(
      appwriteConfig.databaseId,
      collectionId(),
      id,
    );
    return mapDoc(doc as unknown as RawListDoc);
  } catch (err) {
    captureError(err, { service: "lists", op: "getList", listId: id });
    throw toListError(err, "Couldn't load this collection.");
  }
}

export async function createList(input: CreateListInput): Promise<List> {
  const ownerId = await requireMe();
  const isPublic = !!input.isPublic;
  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      collectionId(),
      ID.unique(),
      {
        ownerId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        isPublic,
        restaurantIds: [],
        coverRestaurantId: null,
      },
      permsFor(isPublic, ownerId),
    );
    return mapDoc(doc as unknown as RawListDoc);
  } catch (err) {
    captureError(err, { service: "lists", op: "createList" });
    throw toListError(err, "Couldn't create the collection.");
  }
}

export async function updateList(
  id: string,
  patch: UpdateListInput,
): Promise<List> {
  await requireMe();
  try {
    // Need the owner id to rebuild permissions when visibility flips.
    const current = await getList(id);
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = patch.title.trim();
    if (patch.description !== undefined)
      data.description = patch.description?.trim() || null;
    let permissions: string[] | undefined;
    if (patch.isPublic !== undefined) {
      data.isPublic = patch.isPublic;
      permissions = permsFor(patch.isPublic, current.ownerId);
    }
    const doc = await databases.updateDocument(
      appwriteConfig.databaseId,
      collectionId(),
      id,
      data,
      permissions,
    );
    return mapDoc(doc as unknown as RawListDoc);
  } catch (err) {
    captureError(err, { service: "lists", op: "updateList", listId: id });
    throw toListError(err, "Couldn't update the collection.");
  }
}

export async function deleteList(id: string): Promise<void> {
  await requireMe();
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      collectionId(),
      id,
    );
  } catch (err) {
    captureError(err, { service: "lists", op: "deleteList", listId: id });
    throw toListError(err, "Couldn't delete the collection.");
  }
}

/** The current user's own collections, most-recently-updated first. */
export async function listMyLists(): Promise<List[]> {
  let ownerId: string;
  try {
    ownerId = (await account.get()).$id;
  } catch {
    return []; // not signed in — a state, not an error
  }
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collectionId(),
      [
        Query.equal("ownerId", ownerId),
        Query.orderDesc("$updatedAt"),
        Query.limit(100),
      ],
    );
    return (res.documents as unknown as RawListDoc[]).map(mapDoc);
  } catch (err) {
    captureError(err, { service: "lists", op: "listMyLists" });
    throw toListError(err, "Couldn't load your collections.");
  }
}

/** Another user's PUBLIC collections (private ones aren't readable, so excluded). */
export async function listPublicListsByUser(userId: string): Promise<List[]> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collectionId(),
      [
        Query.equal("ownerId", userId),
        Query.equal("isPublic", true),
        Query.orderDesc("$updatedAt"),
        Query.limit(100),
      ],
    );
    return (res.documents as unknown as RawListDoc[]).map(mapDoc);
  } catch (err) {
    captureError(err, {
      service: "lists",
      op: "listPublicListsByUser",
      targetUserId: userId,
    });
    throw toListError(err, "Couldn't load collections.");
  }
}

// Add/remove a restaurant via read-modify-write of the ids array. Concurrency
// is single-user (you editing your own list), so last-write-wins is fine.
export async function addToList(
  listId: string,
  restaurantId: string,
): Promise<List> {
  await requireMe();
  try {
    const current = await getList(listId);
    const restaurantIds = addRestaurantId(current.restaurantIds, restaurantId);
    const coverRestaurantId = resolveCoverId(
      restaurantIds,
      current.coverRestaurantId,
    );
    const doc = await databases.updateDocument(
      appwriteConfig.databaseId,
      collectionId(),
      listId,
      { restaurantIds, coverRestaurantId },
    );
    return mapDoc(doc as unknown as RawListDoc);
  } catch (err) {
    captureError(err, {
      service: "lists",
      op: "addToList",
      listId,
      restaurantId,
    });
    throw toListError(err, "Couldn't add to the collection.");
  }
}

export async function removeFromList(
  listId: string,
  restaurantId: string,
): Promise<List> {
  await requireMe();
  try {
    const current = await getList(listId);
    const restaurantIds = removeRestaurantId(
      current.restaurantIds,
      restaurantId,
    );
    const coverRestaurantId = resolveCoverId(
      restaurantIds,
      current.coverRestaurantId,
    );
    const doc = await databases.updateDocument(
      appwriteConfig.databaseId,
      collectionId(),
      listId,
      { restaurantIds, coverRestaurantId },
    );
    return mapDoc(doc as unknown as RawListDoc);
  } catch (err) {
    captureError(err, {
      service: "lists",
      op: "removeFromList",
      listId,
      restaurantId,
    });
    throw toListError(err, "Couldn't remove from the collection.");
  }
}

/**
 * A list plus its hydrated restaurants, in list order. Missing restaurants
 * (deleted) are simply skipped. Throws if the list itself can't be loaded;
 * restaurant hydration is tolerant. Review statistics are fetched alongside
 * the restaurant docs because the denormalized rating fields on a restaurant
 * are not client-maintained; this keeps collection cards accurate.
 */
export async function getListWithRestaurants(
  id: string,
): Promise<{ list: List; restaurants: Restaurant[] }> {
  const list = await getList(id);
  if (list.restaurantIds.length === 0) return { list, restaurants: [] };
  // Inline imports avoid circular dependencies at module load.
  const [{ getRestaurantsByIds }, { getReviewStatsForRestaurants }] =
    await Promise.all([
      import("@/services/restaurants"),
      import("@/services/reviews"),
    ]);
  let map: Map<string, Restaurant> = new Map();
  let reviewStats = new Map<string, { count: number; average: number }>();
  try {
    [map, reviewStats] = await Promise.all([
      getRestaurantsByIds(list.restaurantIds),
      getReviewStatsForRestaurants(list.restaurantIds),
    ]);
  } catch (err) {
    captureError(err, {
      service: "lists",
      op: "getListWithRestaurants.hydrate",
      listId: id,
    });
  }
  const restaurants = list.restaurantIds
    .map((rid) => {
      const restaurant = map.get(rid);
      const stats = reviewStats.get(rid);
      return restaurant && stats
        ? {
            ...restaurant,
            reviewCount: stats.count,
            averageRating: stats.average,
          }
        : restaurant;
    })
    .filter((r): r is Restaurant => r != null);
  return { list, restaurants };
}
