import { defaultShouldDehydrateQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type ReactNode } from "react";
import { asyncStoragePersister, queryClient } from "@/lib/queryClient";
import { getRuntimeBackend } from "@/services/backendRuntime";

/** Retain Appwrite's existing offline behavior. Test Supabase never hydrates
 * the legacy shared disk cache; its account-scoped cache lives inside Auth.
 */
export function BackendQueryProvider({ children }: { children: ReactNode }) {
  const [bootstrap] = useState(() => new QueryClient());
  if (getRuntimeBackend() === "supabase") return <QueryClientProvider client={bootstrap}>{children}</QueryClientProvider>;
  return <PersistQueryClientProvider client={queryClient} persistOptions={{
    persister: asyncStoragePersister, maxAge: 24 * 60 * 60 * 1000,
    dehydrateOptions: { shouldDehydrateQuery: query => query.meta?.persist !== false && defaultShouldDehydrateQuery(query) },
  }}>{children}</PersistQueryClientProvider>;
}
