// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/restaurantMenus";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { RestaurantMenuError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export { RestaurantMenuError } from "@/services/serviceErrors";
export const restaurantMenusEnabled: typeof Legacy.restaurantMenusEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.restaurantMenus;
export const getOwnerMenu: typeof Legacy.getOwnerMenu = (...args) => dispatchBackendService<typeof Legacy.getOwnerMenu>("ownerMenus", "getOwnerMenu", args, () => import("@/services/legacy/restaurantMenus"), RestaurantMenuError);
export const updateMyRestaurantMenu: typeof Legacy.updateMyRestaurantMenu = (...args) => dispatchBackendService<typeof Legacy.updateMyRestaurantMenu>("ownerMenus", "updateMyRestaurantMenu", args, () => import("@/services/legacy/restaurantMenus"), RestaurantMenuError);
export const ensureOwnerMenuDoc: typeof Legacy.ensureOwnerMenuDoc = (...args) => dispatchBackendService<typeof Legacy.ensureOwnerMenuDoc>("ownerMenus", "ensureOwnerMenuDoc", args, () => import("@/services/legacy/restaurantMenus"), RestaurantMenuError, true);
