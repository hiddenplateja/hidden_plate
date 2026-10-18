import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getRuntimeBackend } from "@/services/backendRuntime";
import { captureSupabaseActionIdentity } from "@/services/supabaseSessionFence";
import { beginUnscopedAction, createAccountActionScope } from "@/utils/accountActionScope";

/** Supabase-only migration guard; the existing Appwrite behavior is unchanged. */
export function useAccountActionScope() {
  const { user } = useAuth();
  const id = user?.id ?? null;
  const enabled = getRuntimeBackend() === "supabase";
  const scope = useMemo(() => createAccountActionScope(id, captureSupabaseActionIdentity), [id]);
  useEffect(() => { scope.activate(); return () => scope.dispose(); }, [scope]);
  return enabled ? scope.begin : beginUnscopedAction;
}
