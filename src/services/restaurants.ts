// src/services/restaurants.ts
// Restaurant data layer. Screens never call Appwrite directly — they call these.

import * as Location from "expo-location";
import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { deleteImage } from "@/services/storage";
import type {
  CreateRestaurantInput,
  MenuSection,
  OpeningHours,
  Parish,
  PriceRange,
  Restaurant,
  RestaurantFilters,
  RestaurantPage,
  RestaurantSort,
  UpdateRestaurantInput,
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
  plateImage?: string | null;
  openingHours: string | null;
  menu?: string | null;
  averageRating: number;
  reviewCount: number;
  isVerified: boolean;
  isFeatured: boolean;
  isActive: boolean;
  addedBy: string | null;
  ownerId?: string | null;
  featuredUntil?: string | null;
  listingPaidUntil?: string | null;
  searchTerms: string[];
  /** Optional server-search haystack — see buildSearchText / searchRestaurants. */
  searchText?: string | null;
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

// Appwrite string-array attributes can carry stray null entries (e.g. from a
// partially-failed write or a hand-edited doc). Strip anything that isn't a
// real string so callers can safely .toLowerCase()/.includes() the result.
function compactStrings(arr: unknown): string[] {
  return Array.isArray(arr)
    ? arr.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

// Normalize an arbitrary value into clean menu sections — works for both a
// freshly-parsed JSON value and an in-app MenuSection[]. Drops malformed
// sections/items, trims strings, and removes sections with no usable items, so
// a hand-edited or partially-written `menu` value can never crash the UI.
function cleanSections(arr: unknown): MenuSection[] {
  if (!Array.isArray(arr)) return [];
  const sections: MenuSection[] = [];
  for (const s of arr) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const rawItems = Array.isArray(rec.items) ? rec.items : [];
    const items: string[] = [];
    for (const it of rawItems) {
      const name = typeof it === "string" ? it.trim() : "";
      if (name) items.push(name);
    }
    if (items.length === 0) continue;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    sections.push({ title, items });
  }
  return sections;
}

// Menu is stored as a JSON string (an array of { title, items[] } sections).
// Exported so the owner-menu override service (restaurantMenus.ts) reuses the
// same defensive parse/serialize.
export function parseMenu(raw: string | null | undefined): MenuSection[] {
  if (!raw) return [];
  try {
    return cleanSections(JSON.parse(raw));
  } catch {
    console.warn("[restaurants] failed to parse menu");
    return [];
  }
}

// Clean + serialize a menu for storage. Returns null when there's nothing worth
// saving, so the attribute can be omitted entirely on create.
export function serializeMenu(
  menu: MenuSection[] | null | undefined,
): string | null {
  const clean = cleanSections(menu);
  return clean.length > 0 ? JSON.stringify(clean) : null;
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
    cuisines: compactStrings(doc.cuisines),
    categories: compactStrings(doc.categories),
    imageIds: compactStrings(doc.imageIds),
    coverImageId: doc.coverImageId,
    plateImage: doc.plateImage ?? null,
    openingHours: parseOpeningHours(doc.openingHours),
    menu: parseMenu(doc.menu),
    averageRating: doc.averageRating ?? 0,
    reviewCount: doc.reviewCount ?? 0,
    isVerified: doc.isVerified ?? false,
    isFeatured: doc.isFeatured ?? false,
    isActive: doc.isActive ?? true,
    addedBy: doc.addedBy,
    ownerId: doc.ownerId ?? null,
    featuredUntil: doc.featuredUntil ?? null,
    listingPaidUntil: doc.listingPaidUntil ?? null,
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

// Whether the optional `listingPaidUntil` discovery filter is usable. Auto-
// disabled (for this session) if the attribute hasn't been created in Appwrite
// yet, so the listing feature degrades to "no hiding" instead of breaking
// discovery entirely.
let listingFilterSupported = true;

function isMissingListingAttribute(err: unknown): boolean {
  return (
    err instanceof AppwriteException &&
    /listingPaidUntil/i.test(err.message ?? "")
  );
}

// Whether the optional `searchText` attribute exists in the schema. Auto-
// disabled for the session when Appwrite rejects it: reads fall back to the
// legacy client-side filter and writes drop the field instead of failing.
let searchTextSupported = true;

function isMissingSearchText(err: unknown): boolean {
  return (
    err instanceof AppwriteException && /searchText/i.test(err.message ?? "")
  );
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

  // Hide CLAIMED restaurants whose paid listing window has lapsed. Unclaimed and
  // grandfathered listings have a null `listingPaidUntil` and stay visible — so
  // this never affects community submissions. Skipped automatically if the
  // optional `listingPaidUntil` attribute hasn't been added to the schema yet.
  if (listingFilterSupported) {
    queries.push(
      Query.or([
        Query.isNull("listingPaidUntil"),
        Query.greaterThan("listingPaidUntil", new Date().toISOString()),
      ]),
    );
  }

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
    const q = filters.search.toLowerCase();
    // Substring match on the searchText haystack when available; the legacy
    // searchTerms array only matches whole tokens.
    queries.push(
      searchTextSupported
        ? Query.contains("searchText", q)
        : Query.contains("searchTerms", q),
    );
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
    // The optional `listingPaidUntil` attribute isn't in the schema yet — drop
    // the listing filter for the rest of this session and retry so discovery
    // keeps working. Add the attribute in Appwrite to enable listing hiding.
    if (listingFilterSupported && isMissingListingAttribute(err)) {
      listingFilterSupported = false;
      console.warn(
        "[restaurants] listingPaidUntil isn't queryable (attribute or index " +
          "missing) — listing filter disabled for this session. Add the " +
          "attribute + a key index in Appwrite to enable listing hiding.",
      );
      return listRestaurants(options);
    }
    if (searchTextSupported && filters.search && isMissingSearchText(err)) {
      searchTextSupported = false;
      return listRestaurants(options);
    }
    throw toRestaurantError(err, "Failed to load restaurants.");
  }
}

const SEARCH_LIMIT = 50;

/**
 * SERVER-side restaurant search over the whole catalogue — substring match on
 * the `searchText` haystack (name, cuisines, categories, parish, city), active
 * listings only, best-rated first. Falls back to fetching the newest 100 and
 * filtering client-side (the legacy behavior) when the schema doesn't have
 * `searchText` yet, so search never breaks — it just shrinks in reach.
 */
export async function searchRestaurants(term: string): Promise<Restaurant[]> {
  const q = term.trim().toLowerCase();
  if (!q) return [];

  if (searchTextSupported) {
    const queries: string[] = [
      Query.contains("searchText", q),
      Query.equal("isActive", true),
      Query.orderDesc("averageRating"),
      Query.limit(SEARCH_LIMIT),
    ];
    if (listingFilterSupported) {
      queries.push(
        Query.or([
          Query.isNull("listingPaidUntil"),
          Query.greaterThan("listingPaidUntil", new Date().toISOString()),
        ]),
      );
    }
    try {
      const res = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.restaurants,
        queries,
      );
      return (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
    } catch (err) {
      if (listingFilterSupported && isMissingListingAttribute(err)) {
        listingFilterSupported = false;
        return searchRestaurants(term);
      }
      if (isMissingSearchText(err)) {
        searchTextSupported = false;
        console.warn(
          "[restaurants] searchText isn't queryable — server search disabled " +
            "for this session. Add the attribute in Appwrite, then run " +
            "Admin → Rebuild search index.",
        );
        // fall through to the legacy client-side path below
      } else {
        throw toRestaurantError(err, "Search failed. Try again.");
      }
    }
  }

  // Legacy fallback: newest 100 active, substring-filtered client-side.
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      [
        Query.equal("isActive", true),
        Query.orderDesc("$createdAt"),
        Query.limit(100),
      ],
    );
    const all = (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisines.some((c) => c.includes(q)) ||
        r.categories.some((c) => c.includes(q)) ||
        r.parish.replace(/_/g, " ").includes(q) ||
        (r.city?.toLowerCase().includes(q) ?? false),
    );
  } catch (err) {
    throw toRestaurantError(err, "Search failed. Try again.");
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

// ---------- Create (user-submitted listings) ----------

/** URL-safe slug from a name, capped so name+suffix stays well under limits. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return base || "spot";
}

/** Short random suffix so slugs don't collide on duplicate names. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/** Lowercase + trim + de-dupe a tag list (cuisines/categories). */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim().toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Strip a leading @ / whitespace from an Instagram handle. */
function normalizeHandle(handle?: string | null): string | null {
  if (!handle) return null;
  const v = handle.trim().replace(/^@+/, "");
  return v || null;
}

/**
 * Build the lowercase token set used by the search filter
 * (`Query.contains("searchTerms", term)`). Includes the full name, each name
 * word, cuisines, categories, the parish, and the city.
 */
function buildSearchTerms(args: {
  name: string;
  cuisines: string[];
  categories: string[];
  parish: Parish;
  city: string | null;
}): string[] {
  const terms = new Set<string>();
  const add = (s: string) => {
    const v = s.trim().toLowerCase();
    if (v) terms.add(v);
  };
  add(args.name);
  for (const word of args.name.split(/\s+/)) add(word);
  args.cuisines.forEach(add);
  args.categories.forEach(add);
  add(args.parish.replace(/_/g, " "));
  if (args.city) add(args.city);
  return Array.from(terms);
}

/**
 * One lowercase haystack string for SERVER-side substring search
 * (`Query.contains("searchText", q)`). Same fields as buildSearchTerms —
 * kept as a single string because `contains` on a string matches substrings,
 * while on an array it only matches whole elements (the old limitation).
 */
function buildSearchText(args: {
  name: string;
  cuisines: string[];
  categories: string[];
  parish: Parish;
  city: string | null;
}): string {
  return [
    args.name,
    ...args.cuisines,
    ...args.categories,
    args.parish.replace(/_/g, " "),
    args.city ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Create a user-submitted restaurant.
 *
 * Moderation: new listings are created with `isActive: false`, so they're
 * hidden from the app (every list query filters on `isActive === true`) until
 * an admin flips the flag in the Appwrite console. There's no spare Function
 * on the free tier to enforce this server-side, so it's an honest-client
 * default — but the app's own UI never sets it true.
 *
 * Requires: the "restaurants" collection must grant CREATE to the "Users"
 * role in the Appwrite console. Without it, this throws a permissions error.
 */
export async function createRestaurant(
  input: CreateRestaurantInput,
): Promise<Restaurant> {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new RestaurantError("Please enter the restaurant's name.");
  }
  const address = input.address.trim();
  if (!address) {
    throw new RestaurantError("Please enter the address.");
  }
  if (!input.parish) {
    throw new RestaurantError("Please choose a parish.");
  }
  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    (input.latitude === 0 && input.longitude === 0)
  ) {
    throw new RestaurantError("Please set the location on the map.");
  }
  const cuisines = normalizeTags(input.cuisines);
  const categories = normalizeTags(input.categories);
  if (cuisines.length === 0 && categories.length === 0) {
    throw new RestaurantError("Please pick at least one cuisine or category.");
  }

  let me: { $id: string };
  try {
    me = await account.get();
  } catch {
    throw new RestaurantError("You must be signed in to add a restaurant.");
  }

  const city = input.city?.trim() || null;
  const description = input.description?.trim() || null;
  const imageIds = input.imageIds ?? [];
  const searchTerms = buildSearchTerms({
    name,
    cuisines,
    categories,
    parish: input.parish,
    city,
  });

  const data: Record<string, unknown> = {
    name,
    slug: `${slugify(name)}-${randomSuffix()}`,
    description,
    address,
    parish: input.parish,
    city,
    latitude: input.latitude,
    longitude: input.longitude,
    phoneNumber: input.phoneNumber?.trim() || null,
    websiteUrl: input.websiteUrl?.trim() || null,
    instagramHandle: normalizeHandle(input.instagramHandle),
    priceRange: input.priceRange ?? null,
    cuisines,
    categories,
    imageIds,
    coverImageId: input.coverImageId ?? imageIds[0] ?? null,
    openingHours: input.openingHours
      ? JSON.stringify(input.openingHours)
      : null,
    averageRating: 0,
    reviewCount: 0,
    // Default to pending/unflagged for public submissions; admins may
    // publish + flag directly by passing these.
    isVerified: input.isVerified ?? false,
    isFeatured: input.isFeatured ?? false,
    isActive: input.isActive ?? false,
    addedBy: me.$id,
    searchTerms,
  };
  // Server-search haystack — optional attribute; dropped (with the session
  // flag cleared) if the schema doesn't have it, so submission never breaks.
  if (searchTextSupported) {
    data.searchText = buildSearchText({
      name,
      cuisines,
      categories,
      parish: input.parish,
      city,
    });
  }

  // Menu is optional and only included when there are items, so creating a
  // restaurant still works if the `menu` attribute hasn't been added to the
  // collection yet.
  const menuJson = serializeMenu(input.menu);
  if (menuJson) data.menu = menuJson;

  const permissions = [
    // A client can only grant permissions for roles it holds, so set just
    // the submitter's (all signed-in users can read once approved; the
    // submitter can withdraw their pending submission). Admin edit/delete
    // comes from the admins-team grants at the COLLECTION level, applied
    // alongside these when Document Security is on.
    Permission.read(Role.users()),
    Permission.delete(Role.user(me.$id)),
  ];

  try {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      ID.unique(),
      data,
      permissions,
    );
    return mapDoc(doc as unknown as RestaurantDoc);
  } catch (err) {
    if (searchTextSupported && isMissingSearchText(err)) {
      searchTextSupported = false;
      delete data.searchText;
      try {
        const doc = await databases.createDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.restaurants,
          ID.unique(),
          data,
          permissions,
        );
        return mapDoc(doc as unknown as RestaurantDoc);
      } catch (retryErr) {
        throw toRestaurantError(retryErr, "Couldn't submit this restaurant.");
      }
    }
    throw toRestaurantError(err, "Couldn't submit this restaurant.");
  }
}

// ---------- Admin operations ----------

// ---------- Bulk import (admin seeding for cold-start) ----------

/** One restaurant in a bulk import. lat/lng optional — geocoded from the address when absent. */
export interface BulkImportRow {
  name: string;
  address: string;
  parish: Parish;
  city?: string | null;
  latitude?: number;
  longitude?: number;
  cuisines?: string[];
  categories?: string[];
  phoneNumber?: string | null;
  websiteUrl?: string | null;
  instagramHandle?: string | null;
  priceRange?: PriceRange | null;
  description?: string | null;
}

export interface BulkImportResult {
  created: number;
  failed: number;
  /** "name: reason" for each row that failed, so the admin can fix + re-run. */
  errors: string[];
}

// Best-effort forward geocode (system geocoder). Null when it can't resolve.
async function geocodeAddress(
  query: string,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const results = await Location.geocodeAsync(query);
    const first = results[0];
    if (first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
      return { latitude: first.latitude, longitude: first.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Admin: bulk-create seed restaurants from a parsed array. Each is published
 * (isActive) + verified immediately, since it's curated admin content. Rows
 * without lat/lng are geocoded from the address (best-effort). Per-row failures
 * are collected, never aborting the whole batch. Requires the admins-team Create
 * grant on the restaurants collection.
 */
export async function bulkImportRestaurants(
  rows: BulkImportRow[],
): Promise<BulkImportResult> {
  let me: { $id: string };
  try {
    me = await account.get();
  } catch {
    throw new RestaurantError("You must be signed in to import.");
  }

  const result: BulkImportResult = { created: 0, failed: 0, errors: [] };

  for (const row of rows) {
    const label = row?.name?.trim() || "(unnamed)";
    try {
      const name = row.name?.trim();
      if (!name || name.length < 2) throw new Error("missing name");
      const address = row.address?.trim();
      if (!address) throw new Error("missing address");
      if (!row.parish) throw new Error("missing parish");
      const cuisines = normalizeTags(row.cuisines ?? []);
      const categories = normalizeTags(row.categories ?? []);
      if (cuisines.length === 0 && categories.length === 0) {
        throw new Error("needs at least one cuisine or category");
      }

      // Coordinates — provided, else geocoded from the address.
      let lat = row.latitude;
      let lng = row.longitude;
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        (lat === 0 && lng === 0)
      ) {
        const parishText = row.parish.replace(/_/g, " ");
        const coords = await geocodeAddress(
          `${address}, ${row.city ?? ""} ${parishText}, Jamaica`,
        );
        if (!coords) {
          throw new Error("no coordinates — add latitude/longitude");
        }
        lat = coords.latitude;
        lng = coords.longitude;
      }

      const city = row.city?.trim() || null;
      const searchArgs = {
        name,
        cuisines,
        categories,
        parish: row.parish,
        city,
      };
      const data: Record<string, unknown> = {
        name,
        slug: `${slugify(name)}-${randomSuffix()}`,
        description: row.description?.trim() || null,
        address,
        parish: row.parish,
        city,
        latitude: lat,
        longitude: lng,
        phoneNumber: row.phoneNumber?.trim() || null,
        websiteUrl: row.websiteUrl?.trim() || null,
        instagramHandle: normalizeHandle(row.instagramHandle),
        priceRange: row.priceRange ?? null,
        cuisines,
        categories,
        imageIds: [],
        coverImageId: null,
        openingHours: null,
        averageRating: 0,
        reviewCount: 0,
        // Curated admin content → published + verified immediately.
        isVerified: true,
        isFeatured: false,
        isActive: true,
        addedBy: me.$id,
        searchTerms: buildSearchTerms(searchArgs),
      };
      if (searchTextSupported) data.searchText = buildSearchText(searchArgs);

      const permissions = [Permission.read(Role.users())];
      try {
        await databases.createDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.restaurants,
          ID.unique(),
          data,
          permissions,
        );
      } catch (err) {
        // Schema doesn't have searchText yet — drop it and retry once.
        if (searchTextSupported && isMissingSearchText(err)) {
          searchTextSupported = false;
          delete data.searchText;
          await databases.createDocument(
            appwriteConfig.databaseId,
            appwriteConfig.collections.restaurants,
            ID.unique(),
            data,
            permissions,
          );
        } else {
          throw err;
        }
      }
      result.created += 1;
    } catch (err) {
      result.failed += 1;
      const reason =
        err instanceof AppwriteException
          ? err.message
          : err instanceof Error
            ? err.message
            : "failed";
      result.errors.push(`${label}: ${reason}`);
    }
  }

  return result;
}

export type AdminRestaurantStatus = "active" | "pending" | "all";

/**
 * List restaurants for the admin console. Unlike `listRestaurants`, this does
 * NOT force `isActive=true` — `status` selects active / pending / all. Newest
 * first. Search matches the lowercase `searchTerms`.
 */
export async function listAdminRestaurants(
  options: {
    search?: string;
    status?: AdminRestaurantStatus;
    cursor?: string | null;
    pageSize?: number;
  } = {},
): Promise<RestaurantPage> {
  const { search, status = "all", cursor, pageSize = PAGE_SIZE } = options;
  const term = search?.trim().toLowerCase() ?? "";

  const statusQuery = (qs: string[]) => {
    if (status === "active") qs.push(Query.equal("isActive", true));
    else if (status === "pending") qs.push(Query.equal("isActive", false));
  };

  // Searching: server-side substring match on the searchText haystack when the
  // schema has it (covers the whole catalogue, including inactive docs).
  if (term && searchTextSupported) {
    const queries: string[] = [
      Query.contains("searchText", term),
      Query.orderDesc("$createdAt"),
      Query.limit(pageSize),
    ];
    statusQuery(queries);
    try {
      const res = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.restaurants,
        queries,
      );
      const items = (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
      return { items, total: items.length, hasMore: false, nextCursor: null };
    } catch (err) {
      if (isMissingSearchText(err)) {
        searchTextSupported = false;
        // fall through to the client-side path below
      } else {
        throw toRestaurantError(err, "Failed to load restaurants.");
      }
    }
  }

  // Legacy search: fetch a batch and filter client-side. `Query.contains` on
  // the searchTerms array only matches whole tokens, so partial input silently
  // returns nothing — substring filtering is reliable.
  if (term) {
    const queries: string[] = [Query.limit(100), Query.orderDesc("$createdAt")];
    statusQuery(queries);
    try {
      const res = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.restaurants,
        queries,
      );
      const all = (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
      const items = all
        .filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            (r.city?.toLowerCase().includes(term) ?? false) ||
            r.parish.replace(/_/g, " ").includes(term) ||
            r.cuisines.some((c) => c.toLowerCase().includes(term)) ||
            r.categories.some((c) => c.toLowerCase().includes(term)),
        )
        .slice(0, pageSize);
      return { items, total: items.length, hasMore: false, nextCursor: null };
    } catch (err) {
      throw toRestaurantError(err, "Failed to load restaurants.");
    }
  }

  // Browse (no search): server-side pagination.
  const queries: string[] = [Query.limit(pageSize)];
  statusQuery(queries);
  queries.push(Query.orderDesc("$createdAt"));
  if (cursor) queries.push(Query.cursorAfter(cursor));

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

/**
 * Admin edit. Only provided fields are written. Search terms are regenerated
 * when any searchable field (name/cuisines/categories/parish/city) changes.
 * Requires the admins team to have UPDATE on the restaurants collection.
 */
export async function updateRestaurant(
  id: string,
  patch: UpdateRestaurantInput,
): Promise<Restaurant> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.description !== undefined)
    data.description = patch.description?.trim() || null;
  if (patch.address !== undefined) data.address = patch.address.trim();
  if (patch.parish !== undefined) data.parish = patch.parish;
  if (patch.city !== undefined) data.city = patch.city?.trim() || null;
  if (patch.latitude !== undefined) data.latitude = patch.latitude;
  if (patch.longitude !== undefined) data.longitude = patch.longitude;
  if (patch.phoneNumber !== undefined)
    data.phoneNumber = patch.phoneNumber?.trim() || null;
  if (patch.websiteUrl !== undefined)
    data.websiteUrl = patch.websiteUrl?.trim() || null;
  if (patch.instagramHandle !== undefined)
    data.instagramHandle = normalizeHandle(patch.instagramHandle);
  if (patch.priceRange !== undefined) data.priceRange = patch.priceRange ?? null;
  if (patch.cuisines !== undefined) data.cuisines = normalizeTags(patch.cuisines);
  if (patch.categories !== undefined)
    data.categories = normalizeTags(patch.categories);
  if (patch.imageIds !== undefined) data.imageIds = patch.imageIds;
  if (patch.coverImageId !== undefined) data.coverImageId = patch.coverImageId;
  if (patch.openingHours !== undefined)
    data.openingHours = patch.openingHours
      ? JSON.stringify(patch.openingHours)
      : null;
  if (patch.menu !== undefined) data.menu = serializeMenu(patch.menu);
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.isVerified !== undefined) data.isVerified = patch.isVerified;
  if (patch.isFeatured !== undefined) data.isFeatured = patch.isFeatured;

  const touchesSearch =
    patch.name !== undefined ||
    patch.cuisines !== undefined ||
    patch.categories !== undefined ||
    patch.parish !== undefined ||
    patch.city !== undefined;
  if (touchesSearch) {
    const current = await getRestaurantById(id);
    const searchArgs = {
      name: (data.name as string) ?? current.name,
      cuisines: (data.cuisines as string[]) ?? current.cuisines,
      categories: (data.categories as string[]) ?? current.categories,
      parish: (data.parish as Parish) ?? current.parish,
      city: (data.city as string | null) ?? current.city,
    };
    data.searchTerms = buildSearchTerms(searchArgs);
    if (searchTextSupported) data.searchText = buildSearchText(searchArgs);
  }

  try {
    const doc = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      id,
      data,
    );
    return mapDoc(doc as unknown as RestaurantDoc);
  } catch (err) {
    if (searchTextSupported && isMissingSearchText(err)) {
      searchTextSupported = false;
      delete data.searchText;
      try {
        const doc = await databases.updateDocument(
          appwriteConfig.databaseId,
          appwriteConfig.collections.restaurants,
          id,
          data,
        );
        return mapDoc(doc as unknown as RestaurantDoc);
      } catch (retryErr) {
        throw toRestaurantError(retryErr, "Couldn't update this restaurant.");
      }
    }
    throw toRestaurantError(err, "Couldn't update this restaurant.");
  }
}

/** Toggle the admin flags on a restaurant. */
export async function setRestaurantFlags(
  id: string,
  flags: { isActive?: boolean; isVerified?: boolean; isFeatured?: boolean },
): Promise<Restaurant> {
  return updateRestaurant(id, flags);
}

/** Approve a pending submission (publish it; optionally mark verified). */
export async function approveRestaurant(
  id: string,
  opts: { verified?: boolean } = {},
): Promise<Restaurant> {
  return updateRestaurant(id, {
    isActive: true,
    ...(opts.verified ? { isVerified: true } : {}),
  });
}

/** Delete a restaurant + best-effort cleanup of its Storage images. */
export async function deleteRestaurant(id: string): Promise<void> {
  let imageIds: string[] = [];
  try {
    const r = await getRestaurantById(id);
    imageIds = r.imageIds;
  } catch {
    // Couldn't read it — still attempt the delete below.
  }
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      id,
    );
  } catch (err) {
    throw toRestaurantError(err, "Couldn't delete this restaurant.");
  }
  // Image cleanup is best-effort and must never fail the delete.
  await Promise.all(imageIds.map((fid) => deleteImage(fid)));
}

// ---------- Ownership (restaurant claims) ----------

/**
 * Assign or clear a restaurant's owner. Called by the admin Claims queue on
 * approval (set) — and could clear on a future "release ownership" action.
 * Requires the admins team to have UPDATE on the restaurants collection, plus
 * an `ownerId` (string, nullable) attribute on the collection.
 */
export async function setRestaurantOwner(
  id: string,
  ownerId: string | null,
): Promise<void> {
  try {
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      id,
      { ownerId },
    );
  } catch (err) {
    throw toRestaurantError(err, "Couldn't update the restaurant owner.");
  }
}

/**
 * Set (or clear) a restaurant's paid listing expiry. Used to grant the grace
 * window on claim approval; the Cloudflare Worker extends it on purchase.
 * Requires the admins team to have UPDATE on the restaurants collection and a
 * `listingPaidUntil` (datetime, nullable) attribute.
 */
export async function setRestaurantListingPaidUntil(
  id: string,
  iso: string | null,
): Promise<void> {
  try {
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      id,
      { listingPaidUntil: iso },
    );
  } catch (err) {
    throw toRestaurantError(err, "Couldn't update the listing window.");
  }
}

/**
 * Admin maintenance: (re)write `searchText` on every restaurant doc. Run once
 * after creating the attribute in Appwrite — until then, existing docs have no
 * haystack and server search can't match them. Safe to re-run anytime (only
 * writes docs whose haystack is missing or stale). Admin-only: needs the
 * admins-team UPDATE grant on the restaurants collection.
 */
export async function rebuildSearchText(): Promise<{
  scanned: number;
  updated: number;
}> {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  try {
    for (;;) {
      const queries: string[] = [Query.limit(100), Query.orderAsc("$createdAt")];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const res = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.collections.restaurants,
        queries,
      );
      const docs = res.documents as unknown as RestaurantDoc[];
      if (docs.length === 0) break;
      for (const doc of docs) {
        scanned += 1;
        const r = mapDoc(doc);
        const desired = buildSearchText({
          name: r.name,
          cuisines: r.cuisines,
          categories: r.categories,
          parish: r.parish,
          city: r.city,
        });
        if ((doc.searchText ?? "") !== desired) {
          await databases.updateDocument(
            appwriteConfig.databaseId,
            appwriteConfig.collections.restaurants,
            r.id,
            { searchText: desired },
          );
          updated += 1;
        }
      }
      cursor = docs[docs.length - 1].$id;
      if (docs.length < 100) break;
    }
  } catch (err) {
    throw toRestaurantError(
      err,
      "Rebuild failed — check the searchText attribute exists.",
    );
  }
  // Writes succeeded, so the attribute exists — re-enable server search.
  searchTextSupported = true;
  return { scanned, updated };
}

/**
 * Admin: every claimed restaurant (`ownerId` set), newest first. Powers the
 * Owners section — group these by `ownerId` to see who owns what. Requires the
 * `ownerId` attribute + key index; throws a friendly error otherwise.
 */
export async function listClaimedRestaurants(): Promise<Restaurant[]> {
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      [
        Query.isNotNull("ownerId"),
        Query.orderDesc("$createdAt"),
        Query.limit(100),
      ],
    );
    return (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
  } catch (err) {
    throw toRestaurantError(err, "Couldn't load claimed restaurants.");
  }
}

/**
 * Restaurants a user owns (claim approved → `ownerId` set). Tolerant: returns
 * [] on failure or when the attribute doesn't exist yet.
 */
export async function getOwnedRestaurants(
  userId: string,
): Promise<Restaurant[]> {
  if (!userId) return [];
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.restaurants,
      [Query.equal("ownerId", userId), Query.limit(100)],
    );
    return (res.documents as unknown as RestaurantDoc[]).map(mapDoc);
  } catch {
    return [];
  }
}
