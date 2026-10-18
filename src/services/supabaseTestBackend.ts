import { readBackendTestEnvironment, validateSupabaseTestConfiguration, type BackendBuild } from "@/services/backendTestConfiguration";

// Literal imports allow Metro to discover modules; constructing the gateway does
// not initialize Auth/native SDKs, request permissions or contact either backend.
const loaders = {
  auth: () => import("@/services/supabaseAuth"),
  emailAuth: () => import("@/services/supabaseEmailAuth"),
  oauth: () => import("@/services/supabaseOAuth"),
  sessionLifecycle: () => import("@/services/supabaseSessionLifecycle"),
  users: () => import("@/services/supabaseUsers"),
  preferences: () => import("@/services/supabaseUserPreferences"),
  admin: () => import("@/services/supabaseAdmin"),
  restaurants: () => import("@/services/supabaseRestaurants"),
  restaurantAdmin: () => import("@/services/supabaseRestaurantAdmin"),
  reviews: () => import("@/services/supabaseReviews"),
  storage: () => import("@/services/supabaseStorage"),
  relationships: () => import("@/services/supabaseRelationships"),
  saved: () => import("@/services/supabaseSaved"),
  badges: () => import("@/services/supabaseBadges"),
  collections: () => import("@/services/supabaseCollections"),
  posts: () => import("@/services/supabasePosts"),
  social: () => import("@/services/supabaseSocial"),
  likedContent: () => import("@/services/supabaseLikedContent"),
  notifications: () => import("@/services/supabaseNotifications"),
  pushTokens: () => import("@/services/supabasePushTokens"),
  reports: () => import("@/services/supabaseReports"),
  bugReports: () => import("@/services/supabaseBugReports"),
  claims: () => import("@/services/supabaseClaims"),
  menus: () => import("@/services/supabaseRestaurantMenus"),
  ownerReplies: () => import("@/services/supabaseReviewResponses"),
  restaurantViews: () => import("@/services/supabaseRestaurantViews"),
  spotlight: () => import("@/services/supabaseSpotOfTheDay"),
  remoteConfig: () => import("@/services/supabaseRemoteConfig"),
  appConfiguration: () => import("@/services/supabaseAppConfiguration"),
  accountDeletion: () => import("@/services/supabaseAccountDeletion"),
};

export type SupabaseTestDomain = keyof typeof loaders;
export type SupabaseTestModule<K extends SupabaseTestDomain> = Awaited<ReturnType<(typeof loaders)[K]>>;
export const SUPABASE_TEST_DOMAINS: readonly SupabaseTestDomain[] = Object.freeze(Object.keys(loaders) as SupabaseTestDomain[]);

/** Staged-module gateway, NOT a drop-in replacement for the screen service API. */
export function createSupabaseTestBackend(build: BackendBuild) {
  const configuration = validateSupabaseTestConfiguration(build, readBackendTestEnvironment());
  const pending = new Map<SupabaseTestDomain, Promise<unknown>>();
  return Object.freeze({ configuration, domains: SUPABASE_TEST_DOMAINS,
    load<K extends SupabaseTestDomain>(domain: K): Promise<SupabaseTestModule<K>> {
      if (!Object.prototype.hasOwnProperty.call(loaders, domain)) return Promise.reject(new Error("Unknown non-payment service domain."));
      const existing = pending.get(domain);
      if (existing) return existing as Promise<SupabaseTestModule<K>>;
      const request = loaders[domain]().catch((error: unknown) => { pending.delete(domain); throw error; });
      pending.set(domain, request);
      return request as Promise<SupabaseTestModule<K>>;
    },
  });
}
