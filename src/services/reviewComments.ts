// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/reviewComments";
import { dispatchBackendService } from "@/services/backendRuntime";
import { CommentError } from "@/services/serviceErrors";
export { CommentError } from "@/services/serviceErrors";
export const listCommentsForReview: typeof Legacy.listCommentsForReview = (...args) => dispatchBackendService<typeof Legacy.listCommentsForReview>("reviewComments", "listCommentsForReview", args, () => import("@/services/legacy/reviewComments"), CommentError);
export const getCommentById: typeof Legacy.getCommentById = (...args) => dispatchBackendService<typeof Legacy.getCommentById>("reviewComments", "getCommentById", args, () => import("@/services/legacy/reviewComments"), CommentError);
export const addComment: typeof Legacy.addComment = (...args) => dispatchBackendService<typeof Legacy.addComment>("reviewComments", "addComment", args, () => import("@/services/legacy/reviewComments"), CommentError);
export const deleteComment: typeof Legacy.deleteComment = (...args) => dispatchBackendService<typeof Legacy.deleteComment>("reviewComments", "deleteComment", args, () => import("@/services/legacy/reviewComments"), CommentError);
