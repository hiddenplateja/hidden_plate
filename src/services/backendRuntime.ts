import { resolveAppBackend, validateSupabaseTestConfiguration, readBackendTestEnvironment, type BackendBuild } from "@/services/backendTestConfiguration";
import type { SupabaseScreenService, createSupabaseTestScreenServices } from "@/services/supabaseTestScreenServices";
import { captureSupabaseSessionRevision, assertSupabaseSessionRevision } from "@/services/supabaseSessionFence";

let selected: ReturnType<typeof resolveAppBackend> | undefined;
let services: ReturnType<typeof createSupabaseTestScreenServices> | undefined;
export function backendBuild(): BackendBuild {
  const label = process.env.EXPO_PUBLIC_BACKEND_BUILD;
  if (label === "development" || label === "preview" || label === "production") return label;
  if (label !== undefined) throw new Error("Unknown backend build classification.");
  return typeof __DEV__ !== "undefined" && __DEV__ ? "development" : "production";
}
export function getRuntimeBackend() { return selected ?? (selected = resolveAppBackend(backendBuild())); }
export function getRuntimeCacheNamespace(): string {
  return getRuntimeBackend() === "appwrite" ? "hidden-plate:appwrite"
    : validateSupabaseTestConfiguration(backendBuild(), readBackendTestEnvironment()).cacheNamespace;
}
export async function getRuntimeSupabaseServices() {
  if (getRuntimeBackend() !== "supabase") throw new Error("Supabase is not selected.");
  if (!services) { const module = await import("@/services/supabaseTestScreenServices"); services = module.createSupabaseTestScreenServices(backendBuild()); }
  return services;
}
type AsyncFunction = (...args: never[]) => Promise<unknown>;
type ErrorConstructor = new (message: string, code?: string) => Error;
export function dispatchBackendService<F extends AsyncFunction>(service: SupabaseScreenService, method: string,
  args: Parameters<F>, legacy: () => Promise<object>, ErrorType?: ErrorConstructor, legacyOnly = false): ReturnType<F> {
  const run = async () => {
    if (getRuntimeBackend() === "appwrite") {
      const module = await legacy();
      const fn = (module as Record<string, unknown>)[method];
      if (typeof fn !== "function") throw new Error("Unknown Appwrite service operation.");
      return Reflect.apply(fn, module, args);
    }
    try {
      if (legacyOnly) throw new Error("This legacy-only operation is not available in the Supabase test backend.");
      // Capture before either lazy await. Auth actions intentionally change the
      // session; account deletion checks before invocation but may sign out last.
      const ticket = service === "auth" ? null : captureSupabaseSessionRevision();
      const module = await (await getRuntimeSupabaseServices()).load(service);
      if (ticket !== null) assertSupabaseSessionRevision(ticket);
      const fn = (module as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") throw new Error("Unknown Supabase service operation.");
      const result = await Reflect.apply(fn, module, args);
      if (ticket !== null && service !== "accountDeletion") assertSupabaseSessionRevision(ticket);
      return result;
    } catch (error) {
      if (!ErrorType) throw error;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
      throw new ErrorType(error instanceof Error ? error.message : "The operation failed. Please try again.", code);
    }
  };
  return run() as ReturnType<F>;
}
