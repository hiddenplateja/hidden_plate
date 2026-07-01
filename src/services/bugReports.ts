// src/services/bugReports.ts
// In-app "Report a bug" system. Users submit a short report from Settings; it
// lands in a `bugReports` collection that admins triage in /admin/bug-reports.
//
// Design (mirrors src/services/reports.ts):
//   - One doc per submission, with the reporter's user id, a type, the message,
//     and an auto-captured device/app summary so you can reproduce.
//   - The reporter gets per-doc Read (so a future "my reports" view is possible);
//     admins read/update/delete via the collection-level grant to the admins
//     team (set in the console), applied alongside the per-doc grant when
//     Document Security is on.
//   - The whole feature gracefully no-ops when the collection id is unset, so
//     the app runs fine before you create the collection.

import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { AppwriteException, ID, Permission, Query, Role } from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";

export type BugReportType = "bug" | "suggestion" | "other";
export type BugReportStatus = "open" | "resolved";

export interface BugReport {
  id: string;
  createdAt: string;
  userId: string;
  type: BugReportType;
  message: string;
  deviceInfo: string;
  status: BugReportStatus;
}

export class BugReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BugReportError";
  }
}

/** True when the bugReports collection is configured (feature on). */
export function bugReportsEnabled(): boolean {
  return !!appwriteConfig.collections.bugReports;
}

// A compact, human-readable device/app summary stored on each report so you can
// reproduce — e.g. "iPhone 14 · iOS 17.2 · app 1.0.0 (42)".
function deviceSummary(): string {
  const appVersion = Application.nativeApplicationVersion ?? "?";
  const build = Application.nativeBuildVersion ?? "?";
  const os = Device.osName ?? Platform.OS;
  const osVersion = Device.osVersion ?? String(Platform.Version);
  const model = Device.modelName ?? "unknown device";
  return `${model} · ${os} ${osVersion} · app ${appVersion} (${build})`;
}

/**
 * Submit a bug report / suggestion. Captures the signed-in user + device info
 * automatically; the caller only supplies the type and message.
 */
export async function submitBugReport(input: {
  type: BugReportType;
  message: string;
}): Promise<void> {
  if (!bugReportsEnabled()) {
    throw new BugReportError("Bug reporting isn't available right now.");
  }
  const message = input.message.trim();
  if (!message) {
    throw new BugReportError("Please describe the problem before sending.");
  }

  let me;
  try {
    me = await account.get();
  } catch {
    throw new BugReportError("You must be signed in to report a bug.");
  }

  try {
    await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.bugReports,
      ID.unique(),
      {
        userId: me.$id,
        type: input.type,
        message: message.slice(0, 2000),
        deviceInfo: deviceSummary().slice(0, 256),
        status: "open",
      },
      // The reporter can read their own report; admins read/update/delete via
      // the collection-level grant to the admins team.
      [Permission.read(Role.user(me.$id))],
    );
  } catch (err) {
    throw new BugReportError(
      err instanceof AppwriteException
        ? err.message
        : "Couldn't send your report. Try again.",
    );
  }
}

// ─── Admin ───────────────────────────────────────────────────────────────────

interface BugReportDoc {
  $id: string;
  $createdAt: string;
  userId: string;
  type: BugReportType;
  message: string;
  deviceInfo: string | null;
  status: BugReportStatus;
}

function mapReport(doc: BugReportDoc): BugReport {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    userId: doc.userId,
    type: doc.type,
    message: doc.message,
    deviceInfo: doc.deviceInfo ?? "",
    status: doc.status ?? "open",
  };
}

/** List submitted reports, newest first. Admin-only (collection read perm). */
export async function listBugReports(
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<{ items: BugReport[]; nextCursor: string | null; hasMore: boolean }> {
  const { cursor, pageSize = 50 } = opts;
  const queries: string[] = [Query.orderDesc("$createdAt"), Query.limit(pageSize)];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.collections.bugReports,
      queries,
    );
    const items = (res.documents as unknown as BugReportDoc[]).map(mapReport);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return { items, nextCursor: lastId, hasMore: items.length === pageSize };
  } catch (err) {
    throw new BugReportError(
      err instanceof AppwriteException ? err.message : "Failed to load reports.",
    );
  }
}

/** Flip a report between open / resolved. Admin-only. */
export async function updateBugReportStatus(
  id: string,
  status: BugReportStatus,
): Promise<void> {
  try {
    await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.bugReports,
      id,
      { status },
    );
  } catch (err) {
    throw new BugReportError(
      err instanceof AppwriteException ? err.message : "Couldn't update report.",
    );
  }
}

/** Delete a report row. Admin-only. */
export async function deleteBugReport(id: string): Promise<void> {
  try {
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.collections.bugReports,
      id,
    );
  } catch (err) {
    throw new BugReportError(
      err instanceof AppwriteException ? err.message : "Couldn't delete report.",
    );
  }
}
