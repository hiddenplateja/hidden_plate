import { readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBackend, type BackendTestEnvironment } from "@/services/backendTestConfiguration";
import { PAID_FEATURES_ENABLED } from "@/constants/features";

type Profile = { extends?: string; developmentClient?: boolean; distribution?: string; environment?: string;
  android?: { buildType?: string }; env: Record<string, string> };
const profiles = (JSON.parse(readFileSync(resolve(__dirname, "../../../eas.json"), "utf8")) as { build: Record<string, Profile> }).build;
const preview = profiles["preview-supabase"];
function environment(profile: Profile): BackendTestEnvironment {
  return { backend: profile.env.EXPO_PUBLIC_BACKEND, testMode: profile.env.EXPO_PUBLIC_BACKEND_TEST_MODE,
    supabaseUrl: profile.env.EXPO_PUBLIC_SUPABASE_URL, publishableKey: profile.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    mediaUrl: profile.env.EXPO_PUBLIC_MEDIA_WORKER_URL };
}

test("the separate Supabase preview is an internal Android APK, not a development client or store build", () => {
  expect(preview.extends).toBe("preview");
  expect(preview.distribution).toBe("internal");
  expect(preview.developmentClient).toBe(false);
  expect(preview.android?.buildType).toBe("apk");
  expect(preview.env.EXPO_PUBLIC_BACKEND_BUILD).toBe("preview");
  expect(preview.environment).toBe("development");
  expect(resolveAppBackend("preview", environment(preview))).toBe("supabase");
  expect(() => resolveAppBackend("production", environment(preview))).toThrow("production");
  expect(PAID_FEATURES_ENABLED).toBe(false);
});

test.each(["development", "preview", "production"])("the normal %s profile uses Supabase without test mode", name => {
  expect(profiles[name].env.EXPO_PUBLIC_BACKEND).toBe("supabase");
  expect(profiles[name].env.EXPO_PUBLIC_BACKEND_TEST_MODE).toBe("false");
  expect(resolveAppBackend(name as "preview", environment(profiles[name]))).toBe("supabase");
});

test("the preview profile contains only the three public service settings and test selector flags", () => {
  expect(Object.keys(preview.env).sort()).toEqual([
    "EXPO_PUBLIC_BACKEND", "EXPO_PUBLIC_BACKEND_BUILD", "EXPO_PUBLIC_BACKEND_TEST_MODE",
    "EXPO_PUBLIC_MEDIA_WORKER_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EXPO_PUBLIC_SUPABASE_URL",
  ].sort());
  expect(preview.env.EXPO_PUBLIC_SUPABASE_URL).toBe("https://ezhnntopskzlhllljbdv.supabase.co");
  expect(preview.env.EXPO_PUBLIC_MEDIA_WORKER_URL).toBe("https://hidden-plate-pay.hiddenplate-ja.workers.dev");
});

test.each(["preview-supabase", "development", "preview", "production"])("the actual %s runtime connects its facade to Supabase without Appwrite", async profileName => {
  const previous = { ...process.env };
  try {
    jest.resetModules(); Object.assign(process.env, profiles[profileName].env);
    // Only endpoint modules are mocked: selector, runtime, facade, registry and port
    // are real. This is wiring proof, not a live database/device test.
    const getRestaurant = jest.fn().mockResolvedValue({ id: "test-restaurant" });
    jest.doMock("@/services/supabaseRestaurants", () => ({ getSupabaseRestaurantById: getRestaurant }));
    jest.doMock("@/services/supabaseRestaurantAdmin", () => ({}));
    jest.doMock("@/services/appwrite", () => { throw new Error("Unexpected Appwrite initialization"); });
    jest.doMock("react-native-appwrite", () => { throw new Error("Unexpected Appwrite SDK initialization"); });
    const runtime = jest.requireActual("@/services/backendRuntime") as typeof import("@/services/backendRuntime");
    const restaurants = jest.requireActual("@/services/restaurants") as typeof import("@/services/restaurants");
    expect(runtime.getRuntimeBackend()).toBe("supabase");
    expect(await restaurants.getRestaurantById("test-restaurant")).toEqual({ id: "test-restaurant" });
    expect(getRestaurant).toHaveBeenCalledWith("test-restaurant");
    // A later environment mutation cannot silently switch a running app.
    process.env.EXPO_PUBLIC_BACKEND = "appwrite";
    expect(runtime.getRuntimeBackend()).toBe("supabase");
  } finally {
    process.env = previous; jest.resetModules();
    jest.dontMock("@/services/supabaseRestaurants");
    jest.dontMock("@/services/supabaseRestaurantAdmin");
    jest.dontMock("@/services/appwrite"); jest.dontMock("react-native-appwrite");
  }
});
