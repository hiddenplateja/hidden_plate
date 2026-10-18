// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/reviews";
import { dispatchBackendService } from "@/services/backendRuntime";
import { ReviewError } from "@/services/serviceErrors";
export { ReviewError } from "@/services/serviceErrors";
export const listReviewsForRestaurant: typeof Legacy.listReviewsForRestaurant = (...args) => dispatchBackendService<typeof Legacy.listReviewsForRestaurant>("reviews", "listReviewsForRestaurant", args, () => import("@/services/legacy/reviews"), ReviewError);
export const listReviewsByUser: typeof Legacy.listReviewsByUser = (...args) => dispatchBackendService<typeof Legacy.listReviewsByUser>("reviews", "listReviewsByUser", args, () => import("@/services/legacy/reviews"), ReviewError);
export const getReviewById: typeof Legacy.getReviewById = (...args) => dispatchBackendService<typeof Legacy.getReviewById>("reviews", "getReviewById", args, () => import("@/services/legacy/reviews"), ReviewError);
export const getRestaurantReviewStats: typeof Legacy.getRestaurantReviewStats = (...args) => dispatchBackendService<typeof Legacy.getRestaurantReviewStats>("reviews", "getRestaurantReviewStats", args, () => import("@/services/legacy/reviews"), ReviewError);
export const getRestaurantRatingDistribution: typeof Legacy.getRestaurantRatingDistribution = (...args) => dispatchBackendService<typeof Legacy.getRestaurantRatingDistribution>("reviews", "getRestaurantRatingDistribution", args, () => import("@/services/legacy/reviews"), ReviewError);
export const getReviewStatsForRestaurants: typeof Legacy.getReviewStatsForRestaurants = (...args) => dispatchBackendService<typeof Legacy.getReviewStatsForRestaurants>("reviews", "getReviewStatsForRestaurants", args, () => import("@/services/legacy/reviews"), ReviewError);
export const createReview: typeof Legacy.createReview = (...args) => dispatchBackendService<typeof Legacy.createReview>("reviews", "createReview", args, () => import("@/services/legacy/reviews"), ReviewError);
export const updateReview: typeof Legacy.updateReview = (...args) => dispatchBackendService<typeof Legacy.updateReview>("reviews", "updateReview", args, () => import("@/services/legacy/reviews"), ReviewError);
export const deleteReview: typeof Legacy.deleteReview = (...args) => dispatchBackendService<typeof Legacy.deleteReview>("reviews", "deleteReview", args, () => import("@/services/legacy/reviews"), ReviewError);
export const getMyReviewForRestaurant: typeof Legacy.getMyReviewForRestaurant = (...args) => dispatchBackendService<typeof Legacy.getMyReviewForRestaurant>("reviews", "getMyReviewForRestaurant", args, () => import("@/services/legacy/reviews"), ReviewError);
export const getUserReviewStats: typeof Legacy.getUserReviewStats = (...args) => dispatchBackendService<typeof Legacy.getUserReviewStats>("reviews", "getUserReviewStats", args, () => import("@/services/legacy/reviews"), ReviewError);
export const listReviewsByFollowing: typeof Legacy.listReviewsByFollowing = (...args) => dispatchBackendService<typeof Legacy.listReviewsByFollowing>("reviews", "listReviewsByFollowing", args, () => import("@/services/legacy/reviews"), ReviewError);
export const listLatestReviews: typeof Legacy.listLatestReviews = (...args) => dispatchBackendService<typeof Legacy.listLatestReviews>("reviews", "listLatestReviews", args, () => import("@/services/legacy/reviews"), ReviewError);
