import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { dismissSupabaseReport, supabaseCommand, supabaseQueuePage, SUPABASE_UUID } from "@/services/supabaseAdminQueue";
import type { QueueOptions } from "@/services/supabaseAdminQueue";
import type { BugReport, BugReportStatus, BugReportType } from "@/services/bugReports";

type BugRow = { id: string; created_at: string; user_id: string; type: BugReportType; message: string; device_info: string; status: BugReportStatus };
export async function submitSupabaseBugReport(input: { type: BugReportType; message: string }): Promise<void> {
  const message = input.message.trim();
  if (!message) throw new Error("Please describe the problem before sending.");
  const device = `${Device.modelName ?? "unknown device"} · ${Device.osName ?? Platform.OS} ${Device.osVersion ?? String(Platform.Version)} · app ${Application.nativeApplicationVersion ?? "?"} (${Application.nativeBuildVersion ?? "?"})`;
  await supabaseCommand("submit_bug_report", { report_type: input.type, report_message: message.slice(0, 2000), report_device_info: device.slice(0, 256) });
}
export const listSupabaseBugReports = (opts: QueueOptions = {}) => supabaseQueuePage<BugRow, BugReport>("bug",
  r => ({ id: r.id, createdAt: r.created_at, userId: r.user_id, type: r.type, message: r.message, deviceInfo: r.device_info, status: r.status }), opts);
export async function updateSupabaseBugReportStatus(id: string, status: BugReportStatus): Promise<void> {
  if (!SUPABASE_UUID.test(id)) throw new Error("Invalid report.");
  await supabaseCommand("admin_bug_report_status", { report_id: id, new_status: status });
}
export const deleteSupabaseBugReport = (id: string) => dismissSupabaseReport("bug", id);
