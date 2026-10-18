// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/spotOfTheDay";
import { dispatchBackendService } from "@/services/backendRuntime";
export type { SpotOfTheDay, SpotConfig } from "@/services/legacy/spotOfTheDay";
export const getSpotConfig: typeof Legacy.getSpotConfig = (...args) => dispatchBackendService<typeof Legacy.getSpotConfig>("spotlight", "getSpotConfig", args, () => import("@/services/legacy/spotOfTheDay"));
export const setSpotOfTheDay: typeof Legacy.setSpotOfTheDay = (...args) => dispatchBackendService<typeof Legacy.setSpotOfTheDay>("spotlight", "setSpotOfTheDay", args, () => import("@/services/legacy/spotOfTheDay"));
export const resolveSpotOfTheDay: typeof Legacy.resolveSpotOfTheDay = (...args) => dispatchBackendService<typeof Legacy.resolveSpotOfTheDay>("spotlight", "resolveSpotOfTheDay", args, () => import("@/services/legacy/spotOfTheDay"));
