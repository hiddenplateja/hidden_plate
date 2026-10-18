import { supabase } from "@/services/supabase";

/** Bounded before-auth reads: an offline config endpoint must not hold launch. */
export async function readSupabaseAppConfiguration(): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = supabase.rpc("public_app_configuration").abortSignal(controller.signal);
    const result = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("App configuration timed out.")); }, 8000);
      }),
    ]);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
