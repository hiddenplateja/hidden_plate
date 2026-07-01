// src/services/restaurantViews.ts
// Restaurant view tracking — logs UNIQUE viewers (one per user per
// restaurant), not raw opens.
//
// Counts are intentionally NOT shown anywhere in the app. The owner reads
// them in the Appwrite console: open the views collection and filter by
// `restaurantId` — the result total is that restaurant's unique-viewer count.
//
// Why a separate collection instead of a counter on the restaurant doc:
//   - Incrementing a `viewCount` field on the restaurant would require
//     granting Users UPDATE permission on the restaurants collection, which
//     is unsafe (any user could then rename/deactivate any restaurant).
//   - There's no spare Appwrite Function on the free tier to do it
//     server-side. So we log one small doc per (user, restaurant) instead.
//     No write access to the restaurant doc is ever needed.
//
// Everything here is TOLERANT: if the collection isn't configured, the user
// isn't signed in, or a request fails, we degrade silently and report to
// Sentry. View tracking must never break the restaurant screen.
//
// Setup (Appwrite console), all optional — tracking stays dormant until done:
//   1. Create a collection (e.g. "restaurant_views").
//   2. Attributes: restaurantId (string, required), userId (string, required).
//   3. Permissions: Create + Read for the "Users" role.
//   4. (Recommended) An index on restaurantId, and a composite
//      restaurantId+userId index, to keep the lookups fast.
//   5. Set EXPO_PUBLIC_APPWRITE_RESTAURANT_VIEWS_COLLECTION_ID and restart Metro.

import { ID, Permission, Query, Role } from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { captureError } from "@/services/sentry";

/**
 * Record that the current user has viewed a restaurant. Idempotent per
 * (user, restaurant): if a view doc already exists we do nothing, so the
 * count stays "unique viewers". No-ops when unconfigured or signed out.
 */
export async function recordRestaurantView(restaurantId: string): Promise<void> {
  const collection = appwriteConfig.collections.restaurantViews;
  if (!collection || !restaurantId) return;

  let me: { $id: string };
  try {
    me = await account.get();
  } catch {
    // Not signed in — nothing to attribute the view to.
    return;
  }

  try {
    const existing = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [
        Query.equal("restaurantId", restaurantId),
        Query.equal("userId", me.$id),
        Query.limit(1),
      ],
    );
    if (existing.total > 0) return; // already counted this viewer

    await databases.createDocument(
      appwriteConfig.databaseId,
      collection,
      ID.unique(),
      { restaurantId, userId: me.$id },
      [
        // Readable by signed-in users, removable only by the viewer. The
        // restaurant doc itself is never touched.
        Permission.read(Role.users()),
        Permission.delete(Role.user(me.$id)),
      ],
    );
  } catch (err) {
    // A rare race (two fast opens) can create a duplicate — harmless, just a
    // slight over-count. Any other failure is non-fatal.
    captureError(err, {
      service: "restaurantViews",
      op: "recordRestaurantView",
      restaurantId,
    });
  }
}

/**
 * Unique-viewer count for a restaurant — surfaced to the owner in the owner
 * dashboard. View docs are readable by signed-in users, so the owner can read
 * the total. Tolerant: returns 0 when unconfigured or on any failure.
 */
export async function getRestaurantViewCount(
  restaurantId: string,
): Promise<number> {
  const collection = appwriteConfig.collections.restaurantViews;
  if (!collection || !restaurantId) return 0;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [Query.equal("restaurantId", restaurantId), Query.limit(1)],
    );
    return res.total;
  } catch {
    return 0;
  }
}
