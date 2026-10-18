// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/badges";
import { dispatchBackendService } from "@/services/backendRuntime";
export const syncEarnedBadges: typeof Legacy.syncEarnedBadges = (...args) => dispatchBackendService<typeof Legacy.syncEarnedBadges>("badges", "syncEarnedBadges", args, () => import("@/services/legacy/badges"));
