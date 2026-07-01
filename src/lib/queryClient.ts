// src/lib/queryClient.ts
// TanStack Query foundation — ONE client + offline persistence for the app.
//
// Why: nearly every screen re-implemented the same load/refresh/keep-stale
// pattern by hand. React Query centralizes it: request deduping (e.g. the many
// getRestaurantsByIds callers), cached navigation, background refetch on
// foreground, pull-to-refresh via refetch(), and stale-data-on-failed-refresh
// for free. The AsyncStorage persister gives a 24h offline cache so the app
// opens with content even without a connection.
//
// Screens adopt this incrementally — see src/hooks/useHomeFeed.ts for the
// canonical pattern (the home tab is the flagship migration).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Most data here moves slowly (restaurants, reviews). A minute of
      // staleness avoids refetch storms while tab-hopping.
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "hidden-plate-query-cache",
  throttleTime: 2_000,
});

// React Native has no window focus — map AppState to focusManager so queries
// background-refetch when the app returns to the foreground.
AppState.addEventListener("change", (state) => {
  focusManager.setFocused(state === "active");
});
