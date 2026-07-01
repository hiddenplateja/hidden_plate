// src/services/spotOfTheDay.ts
// Resolves the Spot of the Day = MANUAL override (from the Appwrite config doc)
// OR the automatic quality-gated daily pick (utils/spotOfTheDay), then attaches
// a side-thumbnail image pulled at random from that restaurant's reviews.
//
// Manual override — a single document in the optional `appConfig` collection:
//   - spotRestaurantId: string | null  → the pinned restaurant
//   - spotDate:        string | null   → "YYYY-MM-DD"; the pin applies only on
//                                        that day. null = applies until changed.
//
// Tolerant by design: if the config read, the pinned fetch, or the review-image
// fetch fails, we degrade gracefully (auto-pick / no thumbnail) rather than
// breaking the home screen.

import { ID, Permission, Query, Role } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";
import { getRestaurantById } from "@/services/restaurants";
import { listReviewsForRestaurant } from "@/services/reviews";
import { captureError } from "@/services/sentry";
import type { Restaurant } from "@/types/restaurant";
import { pickSpotOfTheDay, seededIndex, spotDayKey } from "@/utils/spotOfTheDay";

export interface SpotOfTheDay {
  restaurant: Restaurant;
  /**
   * A review photo for the side thumbnail, chosen at random (seeded by the day
   * + restaurant so it's stable for 24h). null when the restaurant has no
   * review photos → the hero shows its default placeholder.
   */
  thumbnailImageId: string | null;
}

interface SpotConfigDoc {
  spotRestaurantId?: string | null;
  spotDate?: string | null;
  /** Optional thumbnail override for the manually pinned spot (Storage id). */
  plateImage?: string | null;
}

/** Read the single appConfig doc. Tolerant: null when unconfigured or failed. */
async function readSpotConfig(): Promise<SpotConfigDoc | null> {
  const collection = appwriteConfig.collections.appConfig;
  if (!collection) return null; // not set up → auto-pick only
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [Query.limit(1)],
    );
    return (res.documents[0] as unknown as SpotConfigDoc) ?? null;
  } catch (err) {
    captureError(err, { service: "spotOfTheDay", op: "readSpotConfig" });
    return null;
  }
}

/**
 * Decide WHICH restaurant is today's spot (manual pin → auto-pick). Also
 * reports whether it came from the pin, so the config's plateImage override
 * only applies to a pinned spot (not to an auto-picked one).
 */
async function resolveRestaurant(
  pool: Restaurant[],
  config: SpotConfigDoc | null,
): Promise<{ restaurant: Restaurant | null; pinned: boolean }> {
  const pinnedId = config?.spotRestaurantId ?? null;
  const pinnedDate = config?.spotDate ?? null;
  const appliesToday = !pinnedDate || pinnedDate === spotDayKey();

  if (pinnedId && appliesToday) {
    const inPool = pool.find((r) => r.id === pinnedId);
    if (inPool) return { restaurant: inPool, pinned: true };
    // Pinned spot isn't in the loaded feed — fetch it directly.
    try {
      return { restaurant: await getRestaurantById(pinnedId), pinned: true };
    } catch (err) {
      captureError(err, {
        service: "spotOfTheDay",
        op: "resolve.fetchPinned",
        pinnedId,
      });
      // Unresolved pin → fall through to the automatic pick.
    }
  }

  return { restaurant: pickSpotOfTheDay(pool), pinned: false };
}

/** Pick a (seeded-random) review photo for the side thumbnail, or null. */
async function pickReviewImageId(restaurantId: string): Promise<string | null> {
  try {
    const page = await listReviewsForRestaurant(restaurantId, {
      pageSize: 40,
      sort: "recent",
    });
    const imageIds = page.items.flatMap((r) => r.imageIds);
    if (imageIds.length === 0) return null;
    return imageIds[seededIndex(spotDayKey() + restaurantId, imageIds.length)];
  } catch (err) {
    captureError(err, {
      service: "spotOfTheDay",
      op: "pickReviewImageId",
      restaurantId,
    });
    return null;
  }
}

// ─── Admin: manage the manual pin ────────────────────────────────────────────

export interface SpotConfig {
  /** appConfig doc id, or null when none exists yet. */
  id: string | null;
  spotRestaurantId: string | null;
  spotDate: string | null;
  plateImage: string | null;
}

/** Read the current pin config. null when the appConfig collection is unset. */
export async function getSpotConfig(): Promise<SpotConfig | null> {
  const collection = appwriteConfig.collections.appConfig;
  if (!collection) return null;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [Query.limit(1)],
    );
    const doc = res.documents[0] as unknown as
      | (SpotConfigDoc & { $id: string })
      | undefined;
    if (!doc) {
      return { id: null, spotRestaurantId: null, spotDate: null, plateImage: null };
    }
    return {
      id: doc.$id,
      spotRestaurantId: doc.spotRestaurantId ?? null,
      spotDate: doc.spotDate ?? null,
      plateImage: doc.plateImage ?? null,
    };
  } catch (err) {
    captureError(err, { service: "spotOfTheDay", op: "getSpotConfig" });
    return null;
  }
}

/**
 * Pin (or clear) the Spot of the Day. Pass restaurantId=null to clear the pin
 * (reverts to the automatic daily pick). `date` is "YYYY-MM-DD" to scope the
 * pin to one day, or null to keep it until changed. Admin-only — requires the
 * appConfig collection configured + admins-team write.
 */
export async function setSpotOfTheDay(
  restaurantId: string | null,
  date: string | null = null,
  plateImage: string | null = null,
): Promise<void> {
  const collection = appwriteConfig.collections.appConfig;
  if (!collection) {
    throw new Error(
      "Spot pinning isn't set up — configure EXPO_PUBLIC_APPWRITE_APP_CONFIG_COLLECTION_ID.",
    );
  }
  const data = {
    spotRestaurantId: restaurantId,
    spotDate: date,
    plateImage: restaurantId ? plateImage : null,
  };
  const existing = await databases.listDocuments(
    appwriteConfig.databaseId,
    collection,
    [Query.limit(1)],
  );
  const doc = existing.documents[0];
  if (doc) {
    await databases.updateDocument(
      appwriteConfig.databaseId,
      collection,
      doc.$id,
      data,
    );
    return;
  }
  await databases.createDocument(
    appwriteConfig.databaseId,
    collection,
    ID.unique(),
    data,
    [
      Permission.read(Role.users()),
      ...(appwriteConfig.adminTeamId
        ? [
            Permission.update(Role.team(appwriteConfig.adminTeamId)),
            Permission.delete(Role.team(appwriteConfig.adminTeamId)),
          ]
        : []),
    ],
  );
}

/**
 * Resolve today's Spot of the Day (+ its thumbnail). `pool` is the already-
 * loaded restaurant list (e.g. the home feed's), reused to avoid a refetch.
 */
export async function resolveSpotOfTheDay(
  pool: Restaurant[],
): Promise<SpotOfTheDay | null> {
  const config = await readSpotConfig();
  const { restaurant, pinned } = await resolveRestaurant(pool, config);
  if (!restaurant) return null;

  // Thumbnail fallback chain:
  //   1. app_config.plateImage — only when this spot is the manual pin.
  //   2. restaurant.plateImage  — the per-restaurant hand-picked image.
  //   3. a random review photo.
  //   4. null → the hero shows its default placeholder.
  // A set plate (1 or 2) skips the review fetch entirely.
  const plate =
    (pinned ? config?.plateImage?.trim() : undefined) ||
    restaurant.plateImage?.trim();
  const thumbnailImageId = plate
    ? plate
    : await pickReviewImageId(restaurant.id);

  return { restaurant, thumbnailImageId };
}
