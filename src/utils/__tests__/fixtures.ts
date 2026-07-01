// src/utils/__tests__/fixtures.ts
// Test factories for the pure-logic suites. Not a test file (no `.test.ts`),
// so Jest treats it as a plain module.

import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";

export function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "r1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    name: "Test Spot",
    slug: "test-spot",
    description: null,
    address: "1 Test Rd",
    parish: "kingston",
    city: null,
    latitude: 18,
    longitude: -76.8,
    phoneNumber: null,
    websiteUrl: null,
    instagramHandle: null,
    priceRange: null,
    cuisines: [],
    categories: [],
    imageIds: [],
    coverImageId: null,
    plateImage: null,
    openingHours: null,
    menu: [],
    averageRating: 0,
    reviewCount: 0,
    isVerified: false,
    isFeatured: false,
    isActive: true,
    addedBy: null,
    ownerId: null,
    featuredUntil: null,
    listingPaidUntil: null,
    searchTerms: [],
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "rev1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    restaurantId: "r1",
    userId: "u1",
    rating: 5,
    comment: "Great",
    imageIds: [],
    likeCount: 0,
    commentCount: 0,
    isEdited: false,
    isHidden: false,
    ...overrides,
  };
}
