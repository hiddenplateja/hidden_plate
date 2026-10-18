// Staged Supabase restaurant adapter. Screens remain on Appwrite until cutover.

import { supabase } from "@/services/supabase";
import { requestSupabaseRpc } from "@/services/supabaseDataRequest";
import { SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import { collectSupabasePage } from "@/services/supabasePagination";
import { PAID_FEATURES_ENABLED } from "@/constants/features";
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

export class SupabaseRestaurantError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "SupabaseRestaurantError";
  }
}

export type RestaurantRow = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  slug: string;
  description: string | null;
  address: string;
  parish: Parish;
  city: string | null;
  latitude: number;
  longitude: number;
  phone_number: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  price_range: PriceRange | null;
  cuisines: string[] | null;
  categories: string[] | null;
  image_paths: string[] | null;
  cover_image_path: string | null;
  plate_image_path: string | null;
  opening_hours: OpeningHours | null;
  menu: MenuSection[] | null;
  average_rating: number | null;
  review_count: number | null;
  is_verified: boolean | null;
  is_featured: boolean | null;
  is_active: boolean | null;
  added_by: string | null;
  owner_id: string | null;
  featured_until: string | null;
  listing_paid_until: string | null;
};

const COLUMNS = "id, created_at, updated_at, name, slug, description, address, parish, city, latitude, longitude, phone_number, website_url, instagram_handle, price_range, cuisines, categories, image_paths, cover_image_path, plate_image_path, opening_hours, menu, average_rating, review_count, is_verified, is_featured, is_active, added_by, owner_id, featured_until, listing_paid_until";
const PAGE_SIZE = 25;

export async function createSupabaseRestaurant(input: CreateRestaurantInput): Promise<Restaurant> {
  const { data, error } = await requestSupabaseRpc("submit_restaurant", { payload: restaurantSupabasePayload(input, false) });
  if (error) throw failure(error, "Couldn't submit this restaurant.");
  return mapSupabaseRestaurantResult(data);
}

/** Explicit field mapping protects against extra JS keys outside the TS type. */
export function restaurantSupabasePayload(input: UpdateRestaurantInput, admin: boolean): Record<string, unknown> {
  const fields = { name: "name", description: "description", address: "address", parish: "parish", city: "city",
    latitude: "latitude", longitude: "longitude", phoneNumber: "phone_number", websiteUrl: "website_url",
    instagramHandle: "instagram_handle", priceRange: "price_range", cuisines: "cuisines", categories: "categories",
    imageIds: "image_paths", coverImageId: "cover_image_path", openingHours: "opening_hours", menu: "menu" } as const;
  const payload: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(fields)) {
    const value = input[from as keyof typeof fields];
    if (value !== undefined) payload[to] = value;
  }
  if (admin) {
    if (input.isActive !== undefined) payload.is_active = input.isActive;
    if (input.isVerified !== undefined) payload.is_verified = input.isVerified;
    if (input.isFeatured !== undefined) payload.is_featured = input.isFeatured;
  }
  return payload;
}
export function mapSupabaseRestaurantResult(data: unknown): Restaurant {
  const row = (Array.isArray(data) ? data[0] : data) as RestaurantRow | null;
  if (!row?.id) throw new SupabaseRestaurantError("Couldn't load the restaurant.");
  return mapSupabaseRestaurant(row);
}

function strings(value: string[] | null): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}

export function mapSupabaseRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    slug: row.slug,
    description: row.description,
    address: row.address,
    parish: row.parish,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    phoneNumber: row.phone_number,
    websiteUrl: row.website_url,
    instagramHandle: row.instagram_handle,
    priceRange: row.price_range,
    cuisines: strings(row.cuisines),
    categories: strings(row.categories),
    imageIds: strings(row.image_paths),
    coverImageId: row.cover_image_path,
    plateImage: row.plate_image_path,
    openingHours: row.opening_hours,
    menu: Array.isArray(row.menu) ? row.menu : [],
    averageRating: row.average_rating ?? 0,
    reviewCount: row.review_count ?? 0,
    isVerified: row.is_verified ?? false,
    isFeatured: row.is_featured ?? false,
    isActive: row.is_active ?? true,
    addedBy: row.added_by,
    ownerId: row.owner_id,
    featuredUntil: row.featured_until,
    listingPaidUntil: row.listing_paid_until,
    searchTerms: [],
  };
}

function failure(error: { message: string; code?: string } | null, fallback: string): SupabaseRestaurantError {
  return new SupabaseRestaurantError(error?.message ?? fallback, error?.code);
}

export async function listSupabaseRestaurants(options: {
  filters?: RestaurantFilters;
  sort?: RestaurantSort;
  cursor?: string | null;
  pageSize?: number;
} = {}): Promise<RestaurantPage> {
  const { filters = {}, sort = "rating", cursor, pageSize = PAGE_SIZE } = options;
  const allowed:Record<string,unknown>={};
  for (const key of ["parish","cuisine","category","search","priceRange","featured"] as const) {
    if (filters[key]!==undefined) allowed[key]=filters[key];
  }
  const page=await collectSupabasePage<RestaurantRow>("restaurant_page",{ filters:allowed,sort_by:sort,exclude_expired:PAID_FEATURES_ENABLED },pageSize,cursor);
  return { ...page,items:page.items.map(mapSupabaseRestaurant) };
}

export async function getSupabaseRestaurantById(id: string): Promise<Restaurant> {
  const { data, error } = await supabase.from("restaurants").select(COLUMNS).eq("id", id).single();
  if (error) {
    if (error.code === "PGRST116") throw new SupabaseRestaurantError("Restaurant not found.", "not_found");
    throw failure(error, "Failed to load restaurant.");
  }
  return mapSupabaseRestaurant(data as RestaurantRow);
}

export async function searchSupabaseRestaurants(term: string): Promise<Restaurant[]> {
  const search = term.trim().toLowerCase();
  if (!search) return [];
  return (await listSupabaseRestaurants({ filters: { search }, sort: "rating", pageSize: 50 })).items;
}

export async function getSupabaseRestaurantBySlug(slug: string): Promise<Restaurant> {
  const { data, error } = await supabase.from("restaurants").select(COLUMNS).eq("slug", slug.toLowerCase()).single();
  if (error) {
    if (error.code === "PGRST116") throw new SupabaseRestaurantError("Restaurant not found.", "not_found");
    throw failure(error, "Failed to load restaurant.");
  }
  return mapSupabaseRestaurant(data as RestaurantRow);
}

export async function getSupabaseRestaurantsByIds(ids: string[]): Promise<Map<string, Restaurant>> {
  const uniqueIds = [...new Set(ids.filter(id => SUPABASE_UUID.test(id)))];
  if (uniqueIds.length === 0) return new Map();
  const result = new Map<string, Restaurant>();
  for (let start = 0; start < uniqueIds.length; start += 100) {
    const { data, error } = await supabase.from("restaurants").select(COLUMNS).in("id", uniqueIds.slice(start,start+100));
    if (error) throw failure(error, "Failed to load restaurants.");
    for (const row of (data ?? []) as RestaurantRow[]) { const r = mapSupabaseRestaurant(row); result.set(r.id,r); }
  }
  return result;
}
