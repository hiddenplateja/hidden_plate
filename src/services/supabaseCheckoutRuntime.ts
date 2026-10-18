// Future cutover entry point only. Not imported by the current Appwrite app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { PAID_FEATURES_ENABLED } from "@/constants/features";
import { createStagedSupabaseCheckout } from "@/services/supabaseCheckout";
import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { getMySupabasePurchaseIntent, prepareSupabasePurchaseIntent } from "@/services/supabasePurchaseIntents";

let configured = false;
async function native() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") throw new Error("Native store required.");
  return (await import("react-native-purchases")).default;
}
async function user() {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}
export const stagedSupabaseCheckout = createStagedSupabaseCheckout({
  // This switch is absent by default, and server/DB switches stay disabled too.
  enabled: () => PAID_FEATURES_ENABLED && process.env.EXPO_PUBLIC_SUPABASE_PAYMENTS_ENABLED === "true",
  user, storage: AsyncStorage, prepare: prepareSupabasePurchaseIntent, status: getMySupabasePurchaseIntent,
  submit: async (intentId, storeTransactionId, buyer) => {
    const { data, error } = await supabase.auth.getSession(); const session = data.session;
    if (error || session?.user.id !== buyer) throw new Error("Session changed.");
    const pinned = createIsolatedSupabaseAuthClient();
    const { data: proof, error: proofError } = await pinned.auth.getUser(session.access_token);
    if (proofError || proof.user?.id !== buyer || await user() !== buyer) throw new Error("Session changed.");
    const { data: result, error: invokeError } = await pinned.functions.invoke("verify-purchase", {
      body: { intentId, storeTransactionId }, headers: { Authorization: `Bearer ${session.access_token}` },
      timeout: 30000,
    });
    // Any network/202/disabled/denied result preserves the receipt for retry or
    // support. Do not log JWTs, receipts, purchase tokens or upstream details.
    if (invokeError || result?.code !== "fulfilled" || result?.fulfilled !== true || typeof result.grantedUntil !== "string"
      || !Number.isFinite(Date.parse(result.grantedUntil))) return { fulfilled: false };
    return { fulfilled: true, grantedUntil: result.grantedUntil };
  },
  native: {
    identify: async buyer => {
      const sdk = await native();
      const apiKey = Platform.OS === "ios" ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
      if (!apiKey) throw new Error("Store is not configured.");
      if (!configured) { sdk.configure({ apiKey, appUserID: buyer }); configured = true; }
      else if (await sdk.getAppUserID() !== buyer) await sdk.logIn(buyer);
      // No logout: that creates an anonymous RevenueCat buyer. On app logout,
      // user() denies checkout; next signed-in buyer is explicitly identified.
    },
    identity: async () => (await native()).getAppUserID(),
    buy: async (product, buyer) => {
      const sdk = await native(); const offerings = await sdk.getOfferings();
      const pkg = offerings.current?.availablePackages.find(p => p.product.identifier === product);
      if (!pkg) throw new Error("Product is unavailable.");
      if (await user() !== buyer || await sdk.getAppUserID() !== buyer) throw new Error("Session changed before purchase.");
      const result = await sdk.purchasePackage(pkg);
      return { product: result.productIdentifier, transaction: result.transaction.transactionIdentifier };
    },
  },
});
