// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/blocks";
import { dispatchBackendService } from "@/services/backendRuntime";
import { BlockError } from "@/services/serviceErrors";
export { BlockError } from "@/services/serviceErrors";
export const blockUser: typeof Legacy.blockUser = (...args) => dispatchBackendService<typeof Legacy.blockUser>("blocks", "blockUser", args, () => import("@/services/legacy/blocks"), BlockError);
export const unblockUser: typeof Legacy.unblockUser = (...args) => dispatchBackendService<typeof Legacy.unblockUser>("blocks", "unblockUser", args, () => import("@/services/legacy/blocks"), BlockError);
export const getHiddenUserIds: typeof Legacy.getHiddenUserIds = (...args) => dispatchBackendService<typeof Legacy.getHiddenUserIds>("blocks", "getHiddenUserIds", args, () => import("@/services/legacy/blocks"), BlockError);
export const isBlocked: typeof Legacy.isBlocked = (...args) => dispatchBackendService<typeof Legacy.isBlocked>("blocks", "isBlocked", args, () => import("@/services/legacy/blocks"), BlockError);
export const listBlockedUsers: typeof Legacy.listBlockedUsers = (...args) => dispatchBackendService<typeof Legacy.listBlockedUsers>("blocks", "listBlockedUsers", args, () => import("@/services/legacy/blocks"), BlockError);
