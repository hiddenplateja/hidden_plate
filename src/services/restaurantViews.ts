// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/restaurantViews";
import { dispatchBackendService } from "@/services/backendRuntime";
export const recordRestaurantView: typeof Legacy.recordRestaurantView = (...args) => dispatchBackendService<typeof Legacy.recordRestaurantView>("restaurantViews", "recordRestaurantView", args, () => import("@/services/legacy/restaurantViews"));
export const getRestaurantViewCount: typeof Legacy.getRestaurantViewCount = (...args) => dispatchBackendService<typeof Legacy.getRestaurantViewCount>("restaurantViews", "getRestaurantViewCount", args, () => import("@/services/legacy/restaurantViews"));
