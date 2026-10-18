// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/bugReports";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { BugReportError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export type { BugReportType, BugReportStatus, BugReport } from "@/services/legacy/bugReports";
export { BugReportError } from "@/services/serviceErrors";
export const bugReportsEnabled: typeof Legacy.bugReportsEnabled = () => getRuntimeBackend() === "supabase" || !!getAppwriteConfiguration().collections.bugReports;
export const submitBugReport: typeof Legacy.submitBugReport = (...args) => dispatchBackendService<typeof Legacy.submitBugReport>("bugReports", "submitBugReport", args, () => import("@/services/legacy/bugReports"), BugReportError);
export const listBugReports: typeof Legacy.listBugReports = (...args) => dispatchBackendService<typeof Legacy.listBugReports>("bugReports", "listBugReports", args, () => import("@/services/legacy/bugReports"), BugReportError);
export const updateBugReportStatus: typeof Legacy.updateBugReportStatus = (...args) => dispatchBackendService<typeof Legacy.updateBugReportStatus>("bugReports", "updateBugReportStatus", args, () => import("@/services/legacy/bugReports"), BugReportError);
export const deleteBugReport: typeof Legacy.deleteBugReport = (...args) => dispatchBackendService<typeof Legacy.deleteBugReport>("bugReports", "deleteBugReport", args, () => import("@/services/legacy/bugReports"), BugReportError);
