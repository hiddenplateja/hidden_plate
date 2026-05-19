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
  openingHours: OpeningHours | null; // parsed from JSON string
  averageRating: number;
  reviewCount: number;
  isVerified: boolean;
  isFeatured: boolean;
  isActive: boolean;
  addedBy: string | null;
  searchTerms: string[];
}

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
