// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/reviewResponses";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { ResponseError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export type { ReviewResponse } from "@/services/legacy/reviewResponses";
export { ResponseError } from "@/services/serviceErrors";
export const responsesEnabled: typeof Legacy.responsesEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.reviewResponses;
export const getOwnerResponse: typeof Legacy.getOwnerResponse = (...args) => dispatchBackendService<typeof Legacy.getOwnerResponse>("ownerReplies", "getOwnerResponse", args, () => import("@/services/legacy/reviewResponses"), ResponseError);
export const getOwnerResponsesForReviews: typeof Legacy.getOwnerResponsesForReviews = (...args) => dispatchBackendService<typeof Legacy.getOwnerResponsesForReviews>("ownerReplies", "getOwnerResponsesForReviews", args, () => import("@/services/legacy/reviewResponses"), ResponseError);
export const createResponse: typeof Legacy.createResponse = (...args) => dispatchBackendService<typeof Legacy.createResponse>("ownerReplies", "createResponse", args, () => import("@/services/legacy/reviewResponses"), ResponseError);
export const updateResponse: typeof Legacy.updateResponse = (...args) => dispatchBackendService<typeof Legacy.updateResponse>("ownerReplies", "updateResponse", args, () => import("@/services/legacy/reviewResponses"), ResponseError);
export const deleteResponse: typeof Legacy.deleteResponse = (...args) => dispatchBackendService<typeof Legacy.deleteResponse>("ownerReplies", "deleteResponse", args, () => import("@/services/legacy/reviewResponses"), ResponseError);
