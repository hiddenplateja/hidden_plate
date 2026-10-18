// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/lists";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { ListError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export { ListError } from "@/services/serviceErrors";
export const listsEnabled: typeof Legacy.listsEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.lists;
export const getList: typeof Legacy.getList = (...args) => dispatchBackendService<typeof Legacy.getList>("collections", "getList", args, () => import("@/services/legacy/lists"), ListError);
export const createList: typeof Legacy.createList = (...args) => dispatchBackendService<typeof Legacy.createList>("collections", "createList", args, () => import("@/services/legacy/lists"), ListError);
export const updateList: typeof Legacy.updateList = (...args) => dispatchBackendService<typeof Legacy.updateList>("collections", "updateList", args, () => import("@/services/legacy/lists"), ListError);
export const deleteList: typeof Legacy.deleteList = (...args) => dispatchBackendService<typeof Legacy.deleteList>("collections", "deleteList", args, () => import("@/services/legacy/lists"), ListError);
export const listMyLists: typeof Legacy.listMyLists = (...args) => dispatchBackendService<typeof Legacy.listMyLists>("collections", "listMyLists", args, () => import("@/services/legacy/lists"), ListError);
export const listPublicListsByUser: typeof Legacy.listPublicListsByUser = (...args) => dispatchBackendService<typeof Legacy.listPublicListsByUser>("collections", "listPublicListsByUser", args, () => import("@/services/legacy/lists"), ListError);
export const addToList: typeof Legacy.addToList = (...args) => dispatchBackendService<typeof Legacy.addToList>("collections", "addToList", args, () => import("@/services/legacy/lists"), ListError);
export const removeFromList: typeof Legacy.removeFromList = (...args) => dispatchBackendService<typeof Legacy.removeFromList>("collections", "removeFromList", args, () => import("@/services/legacy/lists"), ListError);
export const getListWithRestaurants: typeof Legacy.getListWithRestaurants = (...args) => dispatchBackendService<typeof Legacy.getListWithRestaurants>("collections", "getListWithRestaurants", args, () => import("@/services/legacy/lists"), ListError);
