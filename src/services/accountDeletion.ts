// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/accountDeletion";
import { dispatchBackendService } from "@/services/backendRuntime";
import { AccountDeletionError } from "@/services/serviceErrors";
export { AccountDeletionError } from "@/services/serviceErrors";
export const deleteMyAccount: typeof Legacy.deleteMyAccount = (...args) => dispatchBackendService<typeof Legacy.deleteMyAccount>("accountDeletion", "deleteMyAccount", args, () => import("@/services/legacy/accountDeletion"), AccountDeletionError);
