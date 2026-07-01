// src/types/restaurant.ts
// Restaurant types. Mirrors the Appwrite schema.

export type Parish =
  | "kingston"
  | "st_andrew"
  | "st_thomas"
  | "portland"
  | "st_mary"
  | "st_ann"
  | "trelawny"
  | "st_james"
  | "hanover"
  | "westmoreland"
  | "st_elizabeth"
  | "manchester"
  | "clarendon"
  | "st_catherine";

export type PriceRange = "$" | "$$" | "$$$" | "$$$$";

// Daily hours stored as JSON string in Appwrite, parsed in app.
export interface DayHours {
  open: string; // "10:00"
  close: string; // "22:00"
}

export interface OpeningHours {
  mon: DayHours[];
  tue: DayHours[];
  wed: DayHours[];
  thu: DayHours[];
  fri: DayHours[];
  sat: DayHours[];
  sun: DayHours[];
}

// Menu — stored as a JSON string in Appwrite, parsed in app. A list of
// sections (e.g. "Mains", "Drinks"), each holding its dish names. Intentionally
// just names: the restaurant-level price range ($–$$$$) covers cost, and
// per-item prices/descriptions are impractical to source for every spot.
export interface MenuSection {
  title: string; // e.g. "Mains"
  items: string[]; // dish names
}

export interface Restaurant {
  id: string; // Appwrite $id
  createdAt: string; // ISO
  updatedAt: string; // ISO
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
  /** Optional hand-picked "plate" image (Storage file id) used for the
   *  Spot-of-the-Day thumbnail. Set per restaurant in the Appwrite console. */
  plateImage: string | null;
  openingHours: OpeningHours | null; // parsed from JSON string
  menu: MenuSection[]; // parsed from JSON string; [] when none
  averageRating: number;
  reviewCount: number;
  isVerified: boolean;
  isFeatured: boolean;
  isActive: boolean;
  addedBy: string | null;
  /** User id of the approved owner — admin sets this on claim approval. null = unclaimed. */
  ownerId: string | null;
  /** ISO expiry for a paid featured window. null = no paid window (manual admin feature has no expiry). */
  featuredUntil: string | null;
  /**
   * ISO expiry of the paid listing window for CLAIMED restaurants. null =
   * not applicable (unclaimed) or grandfathered. When a claimed restaurant's
   * window lapses (date in the past) it's hidden from discovery — enforced in
   * `listRestaurants` via a date filter, no cron needed.
   */
  listingPaidUntil: string | null;
  searchTerms: string[];
}

// Input for creating a user-submitted restaurant. The server-managed fields
// (slug, searchTerms, averageRating, reviewCount, isVerified, isFeatured,
// isActive, addedBy, timestamps) are NOT part of this — the service derives
// or defaults them.
export interface CreateRestaurantInput {
  name: string;
  description?: string | null;
  address: string;
  parish: Parish;
  city?: string | null;
  latitude: number;
  longitude: number;
  phoneNumber?: string | null;
  websiteUrl?: string | null;
  instagramHandle?: string | null;
  priceRange?: PriceRange | null;
  cuisines: string[];
  categories: string[];
  imageIds: string[];
  coverImageId?: string | null;
  openingHours?: OpeningHours | null;
  menu?: MenuSection[] | null;
  // Admin-only. Public submissions leave these unset (default to false /
  // pending). Admins can publish + flag directly.
  isActive?: boolean;
  isVerified?: boolean;
  isFeatured?: boolean;
}

// Partial update for admin restaurant edits — every field optional.
export type UpdateRestaurantInput = Partial<CreateRestaurantInput>;

// Filter options for listRestaurants
export interface RestaurantFilters {
  parish?: Parish;
  cuisine?: string;
  category?: string;
  search?: string;
  priceRange?: PriceRange;
  featured?: boolean;
}

// Sort options
export type RestaurantSort = "recent" | "rating" | "name";

// Paginated list response
export interface RestaurantPage {
  items: Restaurant[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null; // last document $id, used as cursorAfter
}
