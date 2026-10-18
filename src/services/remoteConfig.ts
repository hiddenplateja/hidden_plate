// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/remoteConfig";
import { dispatchBackendService } from "@/services/backendRuntime";
export type { AppGate } from "@/services/legacy/remoteConfig";
export { compareVersions } from "@/utils/versionComparison";
export const fetchAppGate: typeof Legacy.fetchAppGate = (...args) => dispatchBackendService<typeof Legacy.fetchAppGate>("remoteConfig", "fetchAppGate", args, () => import("@/services/legacy/remoteConfig"));
