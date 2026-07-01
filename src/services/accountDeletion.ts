// src/services/accountDeletion.ts
// Self-serve account deletion. Invokes the delete-account Appwrite Function,
// which runs with an API key and cascades through the user's data.
//
// What the client does here:
//   - Fires the function execution (auth context comes from the user's
//     session — the function reads x-appwrite-user-id from headers).
//   - Returns the function's structured response (success + summary, or
//     a thrown error).
//   - DOES NOT log the user out — the function deletes the auth account,
//     which invalidates the session automatically. After this returns,
//     the next account.get() call will fail and the AuthProvider will
//     route the user to the sign-in screen.
//
// Important: errors thrown here should always be surfaced. Silent failure
// means the user thinks they're deleted but they're not.

import { appwriteConfig, functions } from "@/services/appwrite";

export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

interface DeletionSummary {
  reviewsAnonymized: number;
  commentsAnonymized: number;
  likesDeleted: number;
  savedDeleted: number;
  followsDeleted: number;
  notificationsDeleted: number;
  pushTokensDeleted: number;
  reportsDeleted: number;
  userDocDeleted: boolean;
  authAccountDeleted: boolean;
  errors: string[];
}

export async function deleteMyAccount(): Promise<DeletionSummary> {
  let execution;
  try {
    execution = await functions.createExecution({
      functionId: appwriteConfig.functions.deleteAccount,
      body: JSON.stringify({}),
      async: false, // we need to know whether it actually worked
    });
  } catch (err) {
    throw new AccountDeletionError(
      err instanceof Error ? err.message : "Could not contact the server.",
    );
  }

  // Parse function response. Sync execution puts the response body on
  // `responseBody` (newer SDK) or `response` (older SDK) — try both.
  const raw =
    (execution as { responseBody?: string }).responseBody ??
    (execution as { response?: string }).response ??
    "";

  let parsed: { success: boolean; error?: string; summary?: DeletionSummary };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AccountDeletionError(
      "Unexpected response from server. Your account may be partially deleted — please contact support.",
    );
  }

  if (!parsed.success) {
    throw new AccountDeletionError(
      parsed.error ?? "Account deletion failed. Please try again.",
    );
  }

  return parsed.summary as DeletionSummary;
}
