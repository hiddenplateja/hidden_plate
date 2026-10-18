// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/postComments";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { PostCommentError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export { PostCommentError } from "@/services/serviceErrors";
export const POST_COMMENT_MAX_LENGTH = 1000;
export const postCommentsEnabled: typeof Legacy.postCommentsEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.postComments;
export const listCommentsForPost: typeof Legacy.listCommentsForPost = (...args) => dispatchBackendService<typeof Legacy.listCommentsForPost>("postComments", "listCommentsForPost", args, () => import("@/services/legacy/postComments"), PostCommentError);
export const getPostCommentById: typeof Legacy.getPostCommentById = (...args) => dispatchBackendService<typeof Legacy.getPostCommentById>("postComments", "getPostCommentById", args, () => import("@/services/legacy/postComments"), PostCommentError);
export const addPostComment: typeof Legacy.addPostComment = (...args) => dispatchBackendService<typeof Legacy.addPostComment>("postComments", "addPostComment", args, () => import("@/services/legacy/postComments"), PostCommentError);
export const deletePostComment: typeof Legacy.deletePostComment = (...args) => dispatchBackendService<typeof Legacy.deletePostComment>("postComments", "deletePostComment", args, () => import("@/services/legacy/postComments"), PostCommentError);
export const getPostCommentCounts: typeof Legacy.getPostCommentCounts = (...args) => dispatchBackendService<typeof Legacy.getPostCommentCounts>("postComments", "getPostCommentCounts", args, () => import("@/services/legacy/postComments"), PostCommentError);
