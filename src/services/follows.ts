// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/follows";
import { dispatchBackendService } from "@/services/backendRuntime";
import { FollowError } from "@/services/serviceErrors";
export type { FollowListPage } from "@/services/legacy/follows";
export { FollowError } from "@/services/serviceErrors";
export const followUser: typeof Legacy.followUser = (...args) => dispatchBackendService<typeof Legacy.followUser>("follows", "followUser", args, () => import("@/services/legacy/follows"), FollowError);
export const unfollowUser: typeof Legacy.unfollowUser = (...args) => dispatchBackendService<typeof Legacy.unfollowUser>("follows", "unfollowUser", args, () => import("@/services/legacy/follows"), FollowError);
export const isFollowing: typeof Legacy.isFollowing = (...args) => dispatchBackendService<typeof Legacy.isFollowing>("follows", "isFollowing", args, () => import("@/services/legacy/follows"), FollowError);
export const getFollowingIds: typeof Legacy.getFollowingIds = (...args) => dispatchBackendService<typeof Legacy.getFollowingIds>("follows", "getFollowingIds", args, () => import("@/services/legacy/follows"), FollowError);
export const getFollowerIds: typeof Legacy.getFollowerIds = (...args) => dispatchBackendService<typeof Legacy.getFollowerIds>("follows", "getFollowerIds", args, () => import("@/services/legacy/follows"), FollowError);
export const getFollowCounts: typeof Legacy.getFollowCounts = (...args) => dispatchBackendService<typeof Legacy.getFollowCounts>("follows", "getFollowCounts", args, () => import("@/services/legacy/follows"), FollowError);
export const listFollowers: typeof Legacy.listFollowers = (...args) => dispatchBackendService<typeof Legacy.listFollowers>("follows", "listFollowers", args, () => import("@/services/legacy/follows"), FollowError);
export const listFollowing: typeof Legacy.listFollowing = (...args) => dispatchBackendService<typeof Legacy.listFollowing>("follows", "listFollowing", args, () => import("@/services/legacy/follows"), FollowError);
export const getFollowingSetForUsers: typeof Legacy.getFollowingSetForUsers = (...args) => dispatchBackendService<typeof Legacy.getFollowingSetForUsers>("follows", "getFollowingSetForUsers", args, () => import("@/services/legacy/follows"), FollowError);
