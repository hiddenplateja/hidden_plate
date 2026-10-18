// One typed entry point for guarded non-payment screen contracts. Facades and
// providers select this branch only with the explicit non-production test opt-in.
import { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
import type { BackendBuild } from "@/services/backendTestConfiguration";
import * as ports from "@/services/supabaseScreenPorts";

const loaders = {
  auth: ports.loadSupabaseAuthScreenPort,
  admin: ports.loadSupabaseAdminScreenPort,
  users: ports.loadSupabaseUserScreenPort,
  restaurants: ports.loadSupabaseRestaurantScreenPort,
  reviews: ports.loadSupabaseReviewScreenPort,
  storage: ports.loadSupabaseStorageScreenPort,
  saved: ports.loadSupabaseSavedScreenPort,
  badges: ports.loadSupabaseBadgeScreenPort,
  follows: ports.loadSupabaseFollowScreenPort,
  blocks: ports.loadSupabaseBlockScreenPort,
  collections: ports.loadSupabaseCollectionScreenPort,
  posts: ports.loadSupabasePostScreenPort,
  reviewLikes: ports.loadSupabaseReviewLikeScreenPort,
  reviewComments: ports.loadSupabaseReviewCommentScreenPort,
  postLikes: ports.loadSupabasePostLikeScreenPort,
  postComments: ports.loadSupabasePostCommentScreenPort,
  notifications: ports.loadSupabaseNotificationScreenPort,
  pushTokens: ports.loadSupabasePushScreenPort,
  preferences: ports.loadSupabasePreferenceScreenPort,
  reports: ports.loadSupabaseReportScreenPort,
  bugReports: ports.loadSupabaseBugReportScreenPort,
  claims: ports.loadSupabaseClaimScreenPort,
  ownerMenus: ports.loadSupabaseOwnerMenuScreenPort,
  ownerReplies: ports.loadSupabaseOwnerReplyScreenPort,
  restaurantViews: ports.loadSupabaseRestaurantViewScreenPort,
  spotlight: ports.loadSupabaseSpotlightScreenPort,
  remoteConfig: ports.loadSupabaseRemoteConfigScreenPort,
  accountDeletion: ports.loadSupabaseDeletionScreenPort,
};
export type SupabaseScreenService = keyof typeof loaders;
export type SupabaseScreenPort<K extends SupabaseScreenService> = Awaited<ReturnType<(typeof loaders)[K]>>;
export const SUPABASE_SCREEN_SERVICES: readonly SupabaseScreenService[] = Object.freeze(Object.keys(loaders) as SupabaseScreenService[]);
export function createSupabaseTestScreenServices(build: BackendBuild) {
  const gateway = createSupabaseTestBackend(build);
  const pending = new Map<SupabaseScreenService, Promise<unknown>>();
  return Object.freeze({ gateway, services: SUPABASE_SCREEN_SERVICES,
    load<K extends SupabaseScreenService>(service: K): Promise<SupabaseScreenPort<K>> {
      if (!Object.prototype.hasOwnProperty.call(loaders, service)) return Promise.reject(new Error("Unknown non-payment screen service."));
      const cached = pending.get(service);
      if (cached) return cached as Promise<SupabaseScreenPort<K>>;
      const result = loaders[service](gateway).catch((error: unknown) => { pending.delete(service); throw error; });
      pending.set(service, result);
      return result as Promise<SupabaseScreenPort<K>>;
    },
  });
}
