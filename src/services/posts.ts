// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/posts";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { PostError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export { PostError } from "@/services/serviceErrors";
export const POST_MAX_LENGTH = 500;
export const POST_MAX_IMAGES = 4;
export const postsEnabled: typeof Legacy.postsEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.posts;
export const createPost: typeof Legacy.createPost = (...args) => dispatchBackendService<typeof Legacy.createPost>("posts", "createPost", args, () => import("@/services/legacy/posts"), PostError);
export const getPostById: typeof Legacy.getPostById = (...args) => dispatchBackendService<typeof Legacy.getPostById>("posts", "getPostById", args, () => import("@/services/legacy/posts"), PostError);
export const deletePost: typeof Legacy.deletePost = (...args) => dispatchBackendService<typeof Legacy.deletePost>("posts", "deletePost", args, () => import("@/services/legacy/posts"), PostError);
export const listLatestPosts: typeof Legacy.listLatestPosts = (...args) => dispatchBackendService<typeof Legacy.listLatestPosts>("posts", "listLatestPosts", args, () => import("@/services/legacy/posts"), PostError);
export const listPostsByFollowing: typeof Legacy.listPostsByFollowing = (...args) => dispatchBackendService<typeof Legacy.listPostsByFollowing>("posts", "listPostsByFollowing", args, () => import("@/services/legacy/posts"), PostError);
