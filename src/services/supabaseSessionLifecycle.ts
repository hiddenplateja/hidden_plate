import { AppState, Platform } from "react-native";
import { supabase } from "@/services/supabase";

// Explicitly acquired by the migrated auth provider, not at module import.
// Multiple consumers share one native listener; the last release cleans up.
let consumers = 0;
let subscription: ReturnType<typeof AppState.addEventListener> | null = null;

export function acquireSupabaseSessionRefresh(): () => void {
  if (Platform.OS === "web") return () => {};
  consumers++;
  if (consumers === 1) {
    const sync = (state: string | null) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    };
    sync(AppState.currentState);
    subscription = AppState.addEventListener("change", sync);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers--;
    if (consumers === 0) {
      subscription?.remove();
      subscription = null;
      supabase.auth.stopAutoRefresh();
    }
  };
}
