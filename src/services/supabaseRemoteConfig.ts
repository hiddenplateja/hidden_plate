// Used only by the guarded Supabase test path; Appwrite remains the default.
import * as Application from "expo-application";
import { Platform } from "react-native";
import { requestSupabaseRpc } from "@/services/supabaseDataRequest";
import { readSupabaseAppConfiguration } from "@/services/supabaseAppConfiguration";
import type { AppGate } from "@/services/remoteConfig";

export interface SupabaseAppControl {
  maintenance?: boolean | null;
  maintenance_message?: string | null;
  min_version?: string | null;
  latest_version?: string | null;
  update_message?: string | null;
  ios_url?: string | null;
  android_url?: string | null;
}
const maintenanceMessage = "Hidden Plate is down for a quick tune-up. Please check back soon.";
const updateMessage = "A new version of Hidden Plate is available with improvements and fixes.";
function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
// Match the existing dotted numeric comparison, including its suffix tolerance.
export function compareSupabaseVersions(a: string, b: string): number {
  const left = a.split(".").map(n => parseInt(n, 10) || 0);
  const right = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] ?? 0) < (right[i] ?? 0)) return -1;
    if ((left[i] ?? 0) > (right[i] ?? 0)) return 1;
  }
  return 0;
}
export function resolveSupabaseAppGate(control: SupabaseAppControl | null, current: string, platform: string): AppGate {
  if (!control || typeof control !== "object" || Array.isArray(control)) return { status: "ok" };
  if (control.maintenance === true) return { status: "maintenance", message: text(control.maintenance_message, maintenanceMessage) };
  const message = text(control.update_message, updateMessage);
  const rawUrl = text(platform === "ios" ? control.ios_url : control.android_url, "");
  const storeUrl = /^https:\/\/\S+$/.test(rawUrl) ? rawUrl : "";
  if (text(control.min_version, "") && compareSupabaseVersions(current, control.min_version!) < 0) return { status: "update-required", message, storeUrl };
  if (text(control.latest_version, "") && compareSupabaseVersions(current, control.latest_version!) < 0) return { status: "update-optional", message, storeUrl };
  return { status: "ok" };
}
/** Before-auth read, fail-open exactly like the current Appwrite gate. */
export async function fetchSupabaseAppGate(): Promise<AppGate> {
  try {
    const data = await readSupabaseAppConfiguration() as { control?: SupabaseAppControl } | null;
    return resolveSupabaseAppGate(data?.control ?? null, Application.nativeApplicationVersion ?? "0.0.0", Platform.OS);
  } catch { return { status: "ok" }; }
}
export async function patchSupabaseAppControl(payload: SupabaseAppControl): Promise<SupabaseAppControl> {
  const { data, error } = await requestSupabaseRpc("admin_patch_app_control", { payload });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Couldn't load app control.");
  return data as SupabaseAppControl;
}
