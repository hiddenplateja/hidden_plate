// Compile-time screen-contract checks. Type imports do NOT initialize Appwrite.
import type * as LegacyReviews from "@/services/reviews";
import type * as LegacyUsers from "@/services/users";
import type * as LegacyRestaurants from "@/services/restaurants";
import type * as LegacyAdmin from "@/services/admin";
import type { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
import { validateDisplayName, validateUsername, validateBio } from "@/utils/profileValidation";

type Gateway = ReturnType<typeof createSupabaseTestBackend>;

export * from "@/services/supabaseAdditionalScreenPorts";
export { loadSupabaseStorageScreenPort } from "@/services/supabaseStorageScreenPort";
export { loadSupabaseAuthScreenPort, loadSupabasePushScreenPort } from "@/services/supabaseAuthScreenPort";

export async function loadSupabaseReviewScreenPort(gateway: Gateway) {
  const module = await gateway.load("reviews");
  return Object.freeze({
    listReviewsForRestaurant: module.listSupabaseReviewsForRestaurant,
    listReviewsByUser: module.listSupabaseReviewsByUser,
    getReviewById: module.getSupabaseReviewById,
    getRestaurantReviewStats: module.getSupabaseRestaurantReviewStats,
    getRestaurantRatingDistribution: module.getSupabaseRestaurantRatingDistribution,
    getReviewStatsForRestaurants: module.getSupabaseReviewStatsForRestaurants,
    createReview: module.createSupabaseReview,
    updateReview: module.updateSupabaseReview,
    deleteReview: module.deleteSupabaseReview,
    getMyReviewForRestaurant: module.getMySupabaseReviewForRestaurant,
    getUserReviewStats: module.getSupabaseUserReviewStats,
    listReviewsByFollowing: module.listSupabaseReviewsByFollowing,
    listLatestReviews: module.listSupabaseLatestReviews,
  } satisfies Omit<typeof LegacyReviews, "ReviewError">);
}

export async function loadSupabaseUserScreenPort(gateway: Gateway) {
  const module = await gateway.load("users");
  return Object.freeze({
    getUsersByIds: module.getSupabaseUsersByIds,
    getUserById: module.getSupabaseUserById,
    listUsers: module.listSupabaseUsers,
    setUserBanned: module.setSupabaseUserBanned,
    updateMyProfile: module.updateMySupabaseProfile,
    searchUsers: module.searchSupabaseUsers,
    getSuggestedUsers: module.getSupabaseSuggestedUsers,
    validateDisplayName, validateUsername, validateBio,
  } satisfies Omit<typeof LegacyUsers, "UserError">);
}

export async function loadSupabaseRestaurantReadPort(gateway: Gateway) {
  const module = await gateway.load("restaurants");
  return Object.freeze({
    listRestaurants: module.listSupabaseRestaurants,
    getRestaurantById: module.getSupabaseRestaurantById,
    getRestaurantBySlug: module.getSupabaseRestaurantBySlug,
    getRestaurantsByIds: module.getSupabaseRestaurantsByIds,
  } satisfies Pick<typeof LegacyRestaurants, "listRestaurants" | "getRestaurantById" | "getRestaurantBySlug" | "getRestaurantsByIds">);
}

export async function loadSupabaseAdminScreenPort(gateway: Gateway) {
  const module = await gateway.load("admin");
  return Object.freeze({ checkIsAdmin: module.checkSupabaseIsAdmin, getAdminStats: module.getSupabaseAdminStats } satisfies typeof LegacyAdmin);
}
