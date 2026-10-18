// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/admin";
import { dispatchBackendService } from "@/services/backendRuntime";
export type { AdminStats } from "@/services/legacy/admin";
export const checkIsAdmin: typeof Legacy.checkIsAdmin = (...args) => dispatchBackendService<typeof Legacy.checkIsAdmin>("admin", "checkIsAdmin", args, () => import("@/services/legacy/admin"));
export const getAdminStats: typeof Legacy.getAdminStats = (...args) => dispatchBackendService<typeof Legacy.getAdminStats>("admin", "getAdminStats", args, () => import("@/services/legacy/admin"));
