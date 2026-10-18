// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/reviewLikes";
import { dispatchBackendService } from "@/services/backendRuntime";
import { ReviewLikeError } from "@/services/serviceErrors";
export type { LikedReviewsPage } from "@/services/legacy/reviewLikes";
export { ReviewLikeError } from "@/services/serviceErrors";
export const likeReview: typeof Legacy.likeReview = (...args) => dispatchBackendService<typeof Legacy.likeReview>("reviewLikes", "likeReview", args, () => import("@/services/legacy/reviewLikes"), ReviewLikeError);
export const unlikeReview: typeof Legacy.unlikeReview = (...args) => dispatchBackendService<typeof Legacy.unlikeReview>("reviewLikes", "unlikeReview", args, () => import("@/services/legacy/reviewLikes"), ReviewLikeError);
export const hasUserLiked: typeof Legacy.hasUserLiked = (...args) => dispatchBackendService<typeof Legacy.hasUserLiked>("reviewLikes", "hasUserLiked", args, () => import("@/services/legacy/reviewLikes"), ReviewLikeError);
export const getLikedReviewIds: typeof Legacy.getLikedReviewIds = (...args) => dispatchBackendService<typeof Legacy.getLikedReviewIds>("reviewLikes", "getLikedReviewIds", args, () => import("@/services/legacy/reviewLikes"), ReviewLikeError);
export const listLikedReviewsByUser: typeof Legacy.listLikedReviewsByUser = (...args) => dispatchBackendService<typeof Legacy.listLikedReviewsByUser>("reviewLikes", "listLikedReviewsByUser", args, () => import("@/services/legacy/reviewLikes"), ReviewLikeError);
