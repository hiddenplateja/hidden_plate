// src/services/remoteConfig.ts
// App gating (update checker + maintenance / kill-switch), driven by a dedicated
// Appwrite `acontrol` collection (single doc). Edit it in the Appwrite console
// to flip maintenance mode or force an update WITHOUT shipping a new build.
//
// Attributes read off the acontrol doc (all optional):
//   maintenance        boolean  true → block everyone with a maintenance screen
//   maintenanceMessage string   body text for the maintenance screen
//   minVersion         string   installed version below this → forced update
//   latestVersion      string   installed version below this → optional update
//   updateMessage      string   body text for both update prompts
//   iosUrl / androidUrl string  store link the "Update now" button opens
//
// The gate runs at launch BEFORE auth, so the acontrol collection should allow
// guest ("Any") read for maintenance to block the login screen too. See
// REMOTE_CONFIG.md for the exact attributes + permission to add.
//
// FAIL-OPEN by design: a missing collection/doc, a permission error, or a
// network error all resolve to { status: "ok" } so a config problem can never
// lock users out of the app.

import * as Application from "expo-application";
import { Platform } from "react-native";
import { Query } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";
import { captureError } from "@/services/sentry";

export type AppGate =
  | { status: "ok" }
  | { status: "maintenance"; message: string }
  | { status: "update-required"; message: string; storeUrl: string }
  | { status: "update-optional"; message: string; storeUrl: string };

interface AControlDoc {
  maintenance?: boolean | null;
  maintenanceMessage?: string | null;
  minVersion?: string | null;
  latestVersion?: string | null;
  updateMessage?: string | null;
  iosUrl?: string | null;
  androidUrl?: string | null;
}

const DEFAULT_MAINTENANCE =
  "Hidden Plate is down for a quick tune-up. Please check back soon.";
const DEFAULT_UPDATE =
  "A new version of Hidden Plate is available with improvements and fixes.";

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/**
 * Compare two dotted numeric versions ("1.2.0").
 * Returns -1 if a < b, 0 if equal, 1 if a > b. Non-numeric parts count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Read the app_config doc and decide how to gate the app.
 * Always resolves (never throws) — see the FAIL-OPEN note above.
 */
export async function fetchAppGate(): Promise<AppGate> {
  const collection = appwriteConfig.collections.acontrol;
  if (!collection) return { status: "ok" };

  let doc: AControlDoc | undefined;
  try {
    const res = await databases.listDocuments(
      appwriteConfig.databaseId,
      collection,
      [Query.limit(1)],
    );
    doc = res.documents[0] as unknown as AControlDoc | undefined;
  } catch (err) {
    captureError(err, { service: "remoteConfig", op: "fetchAppGate" });
    return { status: "ok" };
  }
  if (!doc) return { status: "ok" };

  // 1) Maintenance / hard block — wins over everything else.
  if (doc.maintenance === true) {
    return {
      status: "maintenance",
      message: str(doc.maintenanceMessage, DEFAULT_MAINTENANCE),
    };
  }

  // 2) Version gating against the installed app version.
  const current = Application.nativeApplicationVersion ?? "0.0.0";
  const storeUrl =
    Platform.OS === "ios" ? str(doc.iosUrl, "") : str(doc.androidUrl, "");
  const updateMessage = str(doc.updateMessage, DEFAULT_UPDATE);

  if (
    typeof doc.minVersion === "string" &&
    doc.minVersion.trim().length > 0 &&
    compareVersions(current, doc.minVersion) < 0
  ) {
    return { status: "update-required", message: updateMessage, storeUrl };
  }
  if (
    typeof doc.latestVersion === "string" &&
    doc.latestVersion.trim().length > 0 &&
    compareVersions(current, doc.latestVersion) < 0
  ) {
    return { status: "update-optional", message: updateMessage, storeUrl };
  }

  return { status: "ok" };
}
