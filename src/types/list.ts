// src/types/list.ts
// User-curated, optionally public "Collections" of restaurants.
// The restaurants live as an ordered array of ids on the list doc — visibility
// is just the document's read permission (see services/lists.ts).

export interface List {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  restaurantIds: string[];
  /** Image source for the cover; falls back to restaurantIds[0]. */
  coverRestaurantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateListInput {
  title: string;
  description?: string | null;
  isPublic?: boolean;
}

export type UpdateListInput = Partial<{
  title: string;
  description: string | null;
  isPublic: boolean;
}>;
