// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/users";
import { dispatchBackendService } from "@/services/backendRuntime";
import { UserError } from "@/services/serviceErrors";
export { UserError } from "@/services/serviceErrors";
export { validateDisplayName, validateUsername, validateBio } from "@/utils/profileValidation";
export const getUsersByIds: typeof Legacy.getUsersByIds = (...args) => dispatchBackendService<typeof Legacy.getUsersByIds>("users", "getUsersByIds", args, () => import("@/services/legacy/users"), UserError);
export const getUserById: typeof Legacy.getUserById = (...args) => dispatchBackendService<typeof Legacy.getUserById>("users", "getUserById", args, () => import("@/services/legacy/users"), UserError);
export const listUsers: typeof Legacy.listUsers = (...args) => dispatchBackendService<typeof Legacy.listUsers>("users", "listUsers", args, () => import("@/services/legacy/users"), UserError);
export const setUserBanned: typeof Legacy.setUserBanned = (...args) => dispatchBackendService<typeof Legacy.setUserBanned>("users", "setUserBanned", args, () => import("@/services/legacy/users"), UserError);
export const updateMyProfile: typeof Legacy.updateMyProfile = (...args) => dispatchBackendService<typeof Legacy.updateMyProfile>("users", "updateMyProfile", args, () => import("@/services/legacy/users"), UserError);
export const searchUsers: typeof Legacy.searchUsers = (...args) => dispatchBackendService<typeof Legacy.searchUsers>("users", "searchUsers", args, () => import("@/services/legacy/users"), UserError);
export const getSuggestedUsers: typeof Legacy.getSuggestedUsers = (...args) => dispatchBackendService<typeof Legacy.getSuggestedUsers>("users", "getSuggestedUsers", args, () => import("@/services/legacy/users"), UserError);
