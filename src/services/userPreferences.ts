// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/userPreferences";
import { dispatchBackendService } from "@/services/backendRuntime";
export type { UserPreferences } from "@/services/legacy/userPreferences";
export { DEFAULT_PREFERENCES } from "@/utils/userPreferencesModel";
export const getUserPreferences: typeof Legacy.getUserPreferences = (...args) => dispatchBackendService<typeof Legacy.getUserPreferences>("preferences", "getUserPreferences", args, () => import("@/services/legacy/userPreferences"));
export const updateUserPreferences: typeof Legacy.updateUserPreferences = (...args) => dispatchBackendService<typeof Legacy.updateUserPreferences>("preferences", "updateUserPreferences", args, () => import("@/services/legacy/userPreferences"));
export const getTastePreferences: typeof Legacy.getTastePreferences = (...args) => dispatchBackendService<typeof Legacy.getTastePreferences>("preferences", "getTastePreferences", args, () => import("@/services/legacy/userPreferences"));
export const setOnboardingPending: typeof Legacy.setOnboardingPending = (...args) => dispatchBackendService<typeof Legacy.setOnboardingPending>("preferences", "setOnboardingPending", args, () => import("@/services/legacy/userPreferences"));
export const completeOnboarding: typeof Legacy.completeOnboarding = (...args) => dispatchBackendService<typeof Legacy.completeOnboarding>("preferences", "completeOnboarding", args, () => import("@/services/legacy/userPreferences"));
