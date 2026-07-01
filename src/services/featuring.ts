// src/services/featuring.ts
// Owner-facing "feature my restaurant" pricing + status helpers.
//
// Plans live in the single `app_config` doc as a `featurePlans` JSON string, so
// labels/days can change without an app update. Each plan maps to a RevenueCat
// `productId` (a consumable in the App Store / Play Store). The displayed price
// is informational — the actual charge is the store-localized price for that
// product; the Cloudflare Worker reads the plan's `days` to set the window.
//
// Payment is a one-time in-app purchase (RevenueCat) — see `purchases.ts`.
// `paymentConfigured()` gates the pay action until the RevenueCat SDK keys are
// set, so the Promote screen stays in a "coming soon" state until then.

import { Query } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";
import {
  purchaseRestaurantProduct,
  revenueCatConfigured,
  type CheckoutResult,
} from "@/services/purchases";
import { captureError } from "@/services/sentry";

export type { CheckoutResult };

export interface FeaturePlan {
  /** Stable id (e.g. "7d", "30d"). */
  id: string;
  /** Display label, e.g. "30 days". */
  label: string;
  /** Days of featured placement this plan buys (read by the worker). */
  days: number;
  /** Price in major currency units (e.g. 8000 = J$8,000) — for display only. */
  amount: number;
  /** ISO 4217 code, e.g. "JMD". */
  currency: string;
  /** Optional ribbon, e.g. "Best value". */
  badge?: string;
  /** RevenueCat / store product id (e.g. "feature_30d"). */
  productId?: string;
}

export const DEFAULT_FEATURE_PLANS: FeaturePlan[] = [
  {
    id: "7d",
    label: "7 days",
    days: 7,
    amount: 2500,
    currency: "JMD",
    productId: "feature_7d",
  },
  {
    id: "30d",
    label: "30 days",
    days: 30,
    amount: 8000,
    currency: "JMD",
    badge: "Best value",
    productId: "feature_30d",
  },
];

interface ConfigDoc {
  featurePlans?: string | null;
}

/**
 * Feature plans from `app_config.featurePlans` (a JSON string), or the built-in
 * defaults when unset/unparseable. Tolerant — never throws.
 */
export async function getFeaturePlans(): Promise<FeaturePlan[]> {
  const collection = appwriteConfig.collections.appConfig;
  if (!collection) return DEFAULT_FEATURE_PLANS;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [Query.limit(1)],
    );
    const doc = res.documents[0] as unknown as ConfigDoc | undefined;
    const raw = doc?.featurePlans?.trim();
    if (!raw) return DEFAULT_FEATURE_PLANS;
    const parsed = JSON.parse(raw) as FeaturePlan[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_FEATURE_PLANS;
  } catch (err) {
    captureError(err, { service: "featuring", op: "getFeaturePlans" });
    return DEFAULT_FEATURE_PLANS;
  }
}

/** Whether in-app purchase (RevenueCat) is live for this platform. */
export function paymentConfigured(): boolean {
  return revenueCatConfigured();
}

/**
 * Run the featured-placement purchase for a restaurant + store product.
 *
 * Delegates to RevenueCat (`purchases.ts`). Resolves "success" once the store
 * confirms the purchase; the restaurant is actually featured a moment later by
 * the worker's RevenueCat webhook, so callers should refetch after a short
 * delay. Returns "cancelled" if the user dismisses the store sheet.
 */
export async function startFeatureCheckout(
  restaurantId: string,
  productId: string,
  userId: string,
): Promise<CheckoutResult> {
  return purchaseRestaurantProduct(restaurantId, productId, userId);
}

/** Format a plan price for display, e.g. (8000, "JMD") → "J$8,000". */
export function formatPrice(amount: number, currency: string): string {
  const n = amount.toLocaleString("en-JM");
  return currency === "JMD" ? `J$${n}` : `${currency} ${n}`;
}

export interface FeaturedStatus {
  active: boolean;
  /** Expiry of the current paid window; null = featured with no expiry (admin). */
  until: Date | null;
}

/**
 * A restaurant's current featured status. Featured = `isFeatured` AND (no
 * expiry OR expiry in the future) — so a lapsed paid window reads as inactive
 * even before anything clears the flag.
 */
export function featuredStatus(
  isFeatured: boolean,
  featuredUntil: string | null,
): FeaturedStatus {
  if (!isFeatured) return { active: false, until: null };
  if (!featuredUntil) return { active: true, until: null };
  const t = new Date(featuredUntil).getTime();
  if (Number.isFinite(t) && t > Date.now()) {
    return { active: true, until: new Date(t) };
  }
  return { active: false, until: null };
}
