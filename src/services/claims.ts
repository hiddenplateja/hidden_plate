// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/claims";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { ClaimError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export type { ClaimStatus, ClaimRole, RestaurantClaim, CreateClaimInput, ClaimPage } from "@/services/legacy/claims";
export { ClaimError } from "@/services/serviceErrors";
export const claimsEnabled: typeof Legacy.claimsEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.restaurantClaims;
export const createClaim: typeof Legacy.createClaim = (...args) => dispatchBackendService<typeof Legacy.createClaim>("claims", "createClaim", args, () => import("@/services/legacy/claims"), ClaimError);
export const getMyClaimForRestaurant: typeof Legacy.getMyClaimForRestaurant = (...args) => dispatchBackendService<typeof Legacy.getMyClaimForRestaurant>("claims", "getMyClaimForRestaurant", args, () => import("@/services/legacy/claims"), ClaimError);
export const listClaims: typeof Legacy.listClaims = (...args) => dispatchBackendService<typeof Legacy.listClaims>("claims", "listClaims", args, () => import("@/services/legacy/claims"), ClaimError);
export const approveClaim: typeof Legacy.approveClaim = (...args) => dispatchBackendService<typeof Legacy.approveClaim>("claims", "approveClaim", args, () => import("@/services/legacy/claims"), ClaimError);
export const rejectClaim: typeof Legacy.rejectClaim = (...args) => dispatchBackendService<typeof Legacy.rejectClaim>("claims", "rejectClaim", args, () => import("@/services/legacy/claims"), ClaimError);
export const countPendingClaims: typeof Legacy.countPendingClaims = (...args) => dispatchBackendService<typeof Legacy.countPendingClaims>("claims", "countPendingClaims", args, () => import("@/services/legacy/claims"), ClaimError);
