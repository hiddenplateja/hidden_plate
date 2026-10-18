// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/saved";
import { dispatchBackendService } from "@/services/backendRuntime";
import { SavedError } from "@/services/serviceErrors";
export type { ListType, SavedDoc } from "@/services/legacy/saved";
export { SavedError } from "@/services/serviceErrors";
export const getSavedStatus: typeof Legacy.getSavedStatus = (...args) => dispatchBackendService<typeof Legacy.getSavedStatus>("saved", "getSavedStatus", args, () => import("@/services/legacy/saved"), SavedError);
export const toggleSaved: typeof Legacy.toggleSaved = (...args) => dispatchBackendService<typeof Legacy.toggleSaved>("saved", "toggleSaved", args, () => import("@/services/legacy/saved"), SavedError);
export const listSavedByUser: typeof Legacy.listSavedByUser = (...args) => dispatchBackendService<typeof Legacy.listSavedByUser>("saved", "listSavedByUser", args, () => import("@/services/legacy/saved"), SavedError);
export const listSavedRestaurants: typeof Legacy.listSavedRestaurants = (...args) => dispatchBackendService<typeof Legacy.listSavedRestaurants>("saved", "listSavedRestaurants", args, () => import("@/services/legacy/saved"), SavedError);
export const getMySavedCount: typeof Legacy.getMySavedCount = (...args) => dispatchBackendService<typeof Legacy.getMySavedCount>("saved", "getMySavedCount", args, () => import("@/services/legacy/saved"), SavedError);
