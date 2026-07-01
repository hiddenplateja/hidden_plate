// src/services/listing.ts
// "Keep your claimed restaurant listed" — the listing fee for owner-claimed
// restaurants. A one-time period (consumable IAP, e.g. 1 year) that extends the
// restaurant's `listingPaidUntil`. When it lapses, the claimed listing is hidden
// from discovery (enforced by a date filter in `listRestaurants`).
//
// Same plumbing as featuring: the purchase is tagged with the restaurant id and
// fulfilled server-side by the Cloudflare Worker's RevenueCat webhook, which
// reads the plan's `days` from app_config and extends `listingPaidUntil`.

import { Query } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";
import {
  purchaseRestaurantProduct,
  revenueCatConfigured,
  type CheckoutResult,
} from "@/services/purchases";
import { captureError } from "@/services/sentry";
import type { Restaurant } from "@/types/restaurant";

export interface ListingPlan {
  /** Stable id (e.g. "1yr"). */
  id: string;
  /** Display label, e.g. "1 year". */
  label: string;
  /** Days of listing this plan buys (read by the worker). */
  days: number;
  /** Price in major units (e.g. 5000 = J$5,000) — for display only. */
  amount: number;
  /** ISO 4217 code, e.g. "JMD". */
  currency: string;
  /** RevenueCat / store product id (e.g. "listing_1yr"). */
  productId: string;
}

export const DEFAULT_LISTING_PLANS: ListingPlan[] = [
  {
    id: "1yr",
    label: "1 year",
    days: 365,
    amount: 5000,
    currency: "JMD",
    productId: "listing_1yr",
  },
];

interface ConfigDoc {
  listingPlans?: string | null;
}

/**
 * Listing plans from `app_config.listingPlans` (a JSON string), or the built-in
 * defaults when unset/unparseable. Tolerant — never throws.
 */
export async function getListingPlans(): Promise<ListingPlan[]> {
  const collection = appwriteConfig.collections.appConfig;
  if (!collection) return DEFAULT_LISTING_PLANS;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [Query.limit(1)],
    );
    const doc = res.documents[0] as unknown as ConfigDoc | undefined;
    const raw = doc?.listingPlans?.trim();
    if (!raw) return DEFAULT_LISTING_PLANS;
    const parsed = JSON.parse(raw) as ListingPlan[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_LISTING_PLANS;
  } catch (err) {
    captureError(err, { service: "listing", op: "getListingPlans" });
    return DEFAULT_LISTING_PLANS;
  }
}

/** Whether in-app purchase (RevenueCat) is live for this platform. */
export function listingPaymentConfigured(): boolean {
  return revenueCatConfigured();
}

/** Buy/renew the listing window for a restaurant. See purchases.ts. */
export async function startListingCheckout(
  restaurantId: string,
  productId: string,
  userId: string,
): Promise<CheckoutResult> {
  return purchaseRestaurantProduct(restaurantId, productId, userId);
}

export type ListingState =
  | "none" // not a claimed restaurant — listing fee doesn't apply
  | "grandfathered" // claimed but no window set — visible, no expiry
  | "active" // paid, comfortably in the future
  | "expiring" // paid but lapsing within EXPIRING_SOON_DAYS
  | "lapsed"; // window passed — hidden from discovery

export interface ListingStatus {
  state: ListingState;
  until: Date | null;
  daysLeft: number | null;
}

const EXPIRING_SOON_DAYS = 14;

/**
 * The listing status for a restaurant, from the owner's point of view. Unclaimed
 * restaurants are "none" (the fee doesn't apply to community listings).
 */
export function listingStatus(restaurant: Restaurant): ListingStatus {
  if (!restaurant.ownerId) return { state: "none", until: null, daysLeft: null };
  if (!restaurant.listingPaidUntil) {
    return { state: "grandfathered", until: null, daysLeft: null };
  }
  const t = new Date(restaurant.listingPaidUntil).getTime();
  if (!Number.isFinite(t)) {
    return { state: "grandfathered", until: null, daysLeft: null };
  }
  const now = Date.now();
  if (t <= now) return { state: "lapsed", until: new Date(t), daysLeft: 0 };
  const daysLeft = Math.ceil((t - now) / 86_400_000);
  return {
    state: daysLeft <= EXPIRING_SOON_DAYS ? "expiring" : "active",
    until: new Date(t),
    daysLeft,
  };
}
