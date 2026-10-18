jest.mock("react-native", () => ({ Platform: { OS: "android" } }), { virtual: true });
jest.mock("@/services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("react-native-purchases", () => { throw new Error("Free launch must not load native purchase SDK."); });

const originalAndroid = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
const originalIos = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
afterAll(() => {
  if (originalAndroid === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY; else process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = originalAndroid;
  if (originalIos === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY; else process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = originalIos;
});
test.each(["android", "ios"])("free launch blocks %s native checkout even when both platform keys are configured", async platform => {
  jest.resetModules();
  const { Platform } = await import("react-native");
  (Platform as unknown as { OS: string }).OS = platform;
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "fixture-public-android-key";
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "fixture-public-ios-key";
  const { PAID_FEATURES_ENABLED } = await import("@/constants/features");
  const { revenueCatConfigured, purchaseRestaurantProduct } = await import("@/services/purchases");
  expect(PAID_FEATURES_ENABLED).toBe(false); expect(revenueCatConfigured()).toBe(false);
  expect(await purchaseRestaurantProduct("restaurant", "feature_7d", "user")).toEqual({ status: "failed" });
  expect(await purchaseRestaurantProduct("restaurant", "listing_1yr", "user")).toEqual({ status: "failed" });
});
