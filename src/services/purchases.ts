// src/services/purchases.ts
// RevenueCat (in-app purchases) wrapper for the B2B one-time products — the
// featured-placement "boost" and the listing renewal.
//
// All native calls are guarded by revenueCatConfigured() — when the SDK keys
// aren't set the whole feature stays dormant, so builds without the native
// module (or before store setup) are unaffected. The SDK is imported lazily so
// nothing touches the native layer until a purchase is actually attempted.
//
// Trust model: this client never grants the feature. It tags the purchase with
// the restaurant id and runs the store purchase; RevenueCat then notifies the
// Cloudflare Worker (webhook) server-to-server, and the WORKER sets the flag
// after independently verifying the buyer owns the restaurant.

import { Platform } from "react-native";

import { captureError } from "@/services/sentry";

export type CheckoutResult =
  | { status: "success" }
  | { status: "failed" }
  | { status: "cancelled" };

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

function platformKey(): string {
  return Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY;
}

/** Whether RevenueCat is configured for this platform (gates the pay action). */
export function revenueCatConfigured(): boolean {
  return !!platformKey();
}

// Tracks which Appwrite user the SDK is currently identified as, so we only
// configure once and switch identity (logIn) when the user changes.
let configuredFor: string | null = null;

async function getConfiguredPurchases(userId: string) {
  const key = platformKey();
  if (!key) throw new Error("RevenueCat is not configured for this platform.");
  const Purchases = (await import("react-native-purchases")).default;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: key, appUserID: userId });
    configuredFor = userId;
  } else if (configuredFor !== userId) {
    await Purchases.logIn(userId);
    configuredFor = userId;
  }
  return Purchases;
}

/**
 * Buy a one-time restaurant product (a featured boost or a listing renewal).
 *
 * Tags the purchase with `feature_restaurant_id` (a subscriber attribute) so the
 * RevenueCat webhook knows which restaurant it's for. The worker still verifies
 * the buyer owns that restaurant, so the attribute can't be abused. Resolves
 * "success" once the store confirms — fulfillment happens server-side via the
 * webhook moments later.
 *
 * The product must be attached to RevenueCat's current Offering.
 */
export async function purchaseRestaurantProduct(
  restaurantId: string,
  productId: string,
  userId: string,
): Promise<CheckoutResult> {
  if (!revenueCatConfigured()) return { status: "failed" };
  try {
    const Purchases = await getConfiguredPurchases(userId);

    await Purchases.setAttributes({ feature_restaurant_id: restaurantId });

    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages.find(
      (p) => p.product.identifier === productId,
    );
    if (!pkg) {
      captureError(new Error(`Product not in offering: ${productId}`), {
        service: "purchases",
        op: "purchaseRestaurantProduct",
        restaurantId,
        productId,
      });
      return { status: "failed" };
    }

    await Purchases.purchasePackage(pkg);
    return { status: "success" };
  } catch (err: unknown) {
    if (isUserCancelled(err)) return { status: "cancelled" };
    captureError(err, {
      service: "purchases",
      op: "purchaseRestaurantProduct",
      restaurantId,
      productId,
    });
    return { status: "failed" };
  }
}

function isUserCancelled(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "userCancelled" in err &&
    (err as { userCancelled?: boolean }).userCancelled === true
  );
}
