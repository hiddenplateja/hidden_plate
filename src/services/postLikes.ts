// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/postLikes";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { PostLikeError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export type { LikedPostsPage } from "@/services/legacy/postLikes";
export { PostLikeError } from "@/services/serviceErrors";
export const postLikesEnabled: typeof Legacy.postLikesEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.postLikes;
export const likePost: typeof Legacy.likePost = (...args) => dispatchBackendService<typeof Legacy.likePost>("postLikes", "likePost", args, () => import("@/services/legacy/postLikes"), PostLikeError);
export const unlikePost: typeof Legacy.unlikePost = (...args) => dispatchBackendService<typeof Legacy.unlikePost>("postLikes", "unlikePost", args, () => import("@/services/legacy/postLikes"), PostLikeError);
export const hasUserLikedPost: typeof Legacy.hasUserLikedPost = (...args) => dispatchBackendService<typeof Legacy.hasUserLikedPost>("postLikes", "hasUserLikedPost", args, () => import("@/services/legacy/postLikes"), PostLikeError);
export const getPostLikeCount: typeof Legacy.getPostLikeCount = (...args) => dispatchBackendService<typeof Legacy.getPostLikeCount>("postLikes", "getPostLikeCount", args, () => import("@/services/legacy/postLikes"), PostLikeError);
export const getLikedPostIds: typeof Legacy.getLikedPostIds = (...args) => dispatchBackendService<typeof Legacy.getLikedPostIds>("postLikes", "getLikedPostIds", args, () => import("@/services/legacy/postLikes"), PostLikeError);
export const getPostLikeCounts: typeof Legacy.getPostLikeCounts = (...args) => dispatchBackendService<typeof Legacy.getPostLikeCounts>("postLikes", "getPostLikeCounts", args, () => import("@/services/legacy/postLikes"), PostLikeError);
export const listLikedPostsByUser: typeof Legacy.listLikedPostsByUser = (...args) => dispatchBackendService<typeof Legacy.listLikedPostsByUser>("postLikes", "listLikedPostsByUser", args, () => import("@/services/legacy/postLikes"), PostLikeError);
