// src/services/restaurants.ts
// Restaurant data layer. Screens never call Appwrite directly — they call these.

import { AppwriteException, Query } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";
import type {
  OpeningHours,
  Parish,
  PriceRange,
  Restaurant,
  RestaurantFilters,
  RestaurantPage,
  RestaurantSort,
} from "@/types/restaurant";

// ---------- Errors ----------

export class RestaurantError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "RestaurantError";
  }
}

function toRestaurantError(err: unknown, fallback: string): RestaurantError {
  if (err instanceof AppwriteException) {
    return new RestaurantError(err.message || fallback, err.type);
  }
  return new RestaurantError(fallback);
}

// ---------- Mapping ----------

interface RestaurantDoc {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  name: string;
  slug: string;
  description: string | null;
  address: string;
  parish: Parish;
  city: string | null;
  latitude: number;
  longitude: number;
  phoneNumber: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  priceRange: PriceRange | null;
  cuisines: string[];
  categories: string[];
  imageIds: string[];
  coverImageId: string | null;
  openingHours: string | null;
  averageRating: number;
  reviewCount: number;
  isVerified: boolean;
  isFeatured: boolean;
  isActive: boolean;
  addedBy: string | null;
  searchTerms: string[];
}

function parseOpeningHours(raw: string | null): OpeningHours | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OpeningHours;
  } catch {
    console.warn("[restaurants] failed to parse openingHours:", raw);
    return null;
  }
}

function mapDoc(doc: RestaurantDoc): Restaurant {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    address: doc.address,
    parish: doc.parish,
    city: doc.city,
    latitude: doc.latitude,
    longitude: doc.longitude,
    phoneNumber: doc.phoneNumber,
    websiteUrl: doc.websiteUrl,
    instagramHandle: doc.instagramHandle,
    priceRange: doc.priceRange,
    cuisines: doc.cuisines ?? [],
    categories: doc.categories ?? [],
    imageIds: doc.imageIds ?? [],
    coverImageId: doc.coverImageId,
    openingHours: parseOpeningHours(doc.openingHours),
    averageRating: doc.averageRating ?? 0,
    reviewCount: doc.reviewCount ?? 0,
    isVerified: doc.isVerified ?? false,
    isFeatured: doc.isFeatured ?? false,
    isActive: doc.isActive ?? true,
    addedBy: doc.addedBy,
    searchTerms: doc.searchTerms ?? [],
  };
}

// ---------- Public API ----------

const PAGE_SIZE = 25;

interface ListOptions {
  filters?: RestaurantFilters;
  sort?: RestaurantSort;
  cursor?: string | null;
  pageSize?: number;
}

export async function listRestaurants(
  options: ListOptions = {},
): Promise<RestaurantPage> {
  const {
    filters = {},
    sort = "rating",
    cursor,
    pageSize = PAGE_SIZE,
  } = options;

  const queries: string[] = [
    Query.equal("isActive", true),
    Query.limit(pageSize),
  ];

  if (filters.parish) {
    queries.push(Query.equal("parish", filters.parish));
  }
  if (filters.cuisine) {
    queries.push(Query.contains("cuisines", filters.cuisine.toLowerCase()));
  }
  if (filters.category) {
    queries.push(Query.contains("categories", filters.category.toLowerCase()));
  }
  if (filters.priceRange) {
    queries.push(Query.equal("priceRange", filters.priceRange));
  }
  if (filters.featured === true) {
    queries.push(Query.equal("isFeatured", true));
  }
  if (filters.search) {
    queries.push(Query.contains("searchTerms", filters.search.toLowerCase()));
  }

  switch (sort) {
    case "rating":
      queries.push(Query.orderDesc("averageRating"));
      break;
    case "recent":
      queries.push(Query.orderDesc("$createdAt"));
      break;
    case "name":
      queries.push(Query.orderAsc("name"));
      break;
  }

  if (cursor) {
    queries.push(Query.cursorAfter(cursor));
  }

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      queries,
    );

    const items = (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;

    return {
      items,
      total: res.total,
      hasMore: items.length === pageSize,
      nextCursor: lastId,
    };
  } catch (err) {
    throw toRestaurantError(err, "Failed to load restaurants.");
  }
}

export async function getRestaurantById(id: string): Promise<Restaurant> {
  try {
    const doc = await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      id,
    );
    return mapDoc(doc as unknown as RestaurantDoc);
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) {
      throw new RestaurantError("Restaurant not found.", "not_found");
    }
    throw toRestaurantError(err, "Failed to load restaurant.");
  }
}

export async function getRestaurantBySlug(slug: string): Promise<Restaurant> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      [Query.equal("slug", slug.toLowerCase()), Query.limit(1)],
    );
    const doc = res.documents[0];
    if (!doc) {
      throw new RestaurantError("Restaurant not found.", "not_found");
    }
    return mapDoc(doc as unknown as RestaurantDoc);
  } catch (err) {
    if (err instanceof RestaurantError) throw err;
    throw toRestaurantError(err, "Failed to load restaurant.");
  }
}

// NOTE: We previously had a `recomputeRestaurantStats` helper that updated
// the denormalized averageRating + reviewCount on the restaurant doc.
// That required Update permission for Users role on the restaurants
// collection — which is unsafe (any user could rename Scotchies).
//
// We now compute review stats on demand in the detail screen via
// getRestaurantReviewStats() in services/reviews.ts. Slightly slower,
// always accurate. When you add an Appwrite Cloud Function later for
// production scale, that function can update the denormalized fields
// server-side without exposing write access to clients.

/**
 * Batch-fetch restaurants by IDs. Used by the Saved tab to hydrate
 * saved docs (which only store restaurantId) into full restaurant data.
 *
 * Returns a Map keyed by restaurant.id. Restaurants that don't exist
 * (deleted) are simply absent from the map.
 *
 * Single query — much cheaper than N individual getRestaurantById calls.
 */
export async function getRestaurantsByIds(
  ids: string[],
): Promise<Map<string, Restaurant>> {
  if (ids.length === 0) return new Map();
  const unique = Array.from(new Set(ids));

  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      [Query.equal("$id", unique), Query.limit(unique.length)],
    );
    const map = new Map<string, Restaurant>();
    for (const doc of res.documents) {
      const r = mapDoc(doc as unknown as RestaurantDoc);
      map.set(r.id, r);
    }
    return map;
  } catch (err) {
    console.warn("[restaurants] batch fetch failed:", err);
    return new Map();
  }
}
