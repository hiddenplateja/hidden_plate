// src/services/sentry.ts
// Sentry helpers — initialization, user context, and error capture.
//
// The actual Sentry.init() call lives in app/_layout.tsx (the wizard
// auto-injected it there). This file provides everything else:
//   - identifyUser / clearUser: tag errors with the signed-in user
//   - captureError: explicit error reporting from anywhere
//
// captureError is the function we'll use heavily next session when we
// refactor service-layer silent failures. Anywhere we currently do
// `console.warn("[service] failed", err)` we'll switch to
// `captureError(err, { service: "reviews", op: "listForRestaurant" })`
// which logs AND reports — best of both worlds.

import * as Sentry from "@sentry/react-native";

interface UserIdentity {
  id: string;
  email?: string | null;
  username?: string | null;
}

/**
 * Tag all subsequent errors with this user. Call after a successful
 * sign-in / sign-up / session restore. The user ID lets you filter the
 * Sentry dashboard to "errors that affected user X" — useful when a
 * specific user reports a bug.
 *
 * We deliberately don't send email or username by default to keep PII
 * minimal — Sentry's `sendDefaultPii: true` in app/_layout.tsx covers
 * IP/device info; identity is opt-in per field.
 */
export function identifyUser(user: UserIdentity): void {
  Sentry.setUser({
    id: user.id,
    // username helps you find users in the dashboard without exposing email
    username: user.username ?? undefined,
  });
}

/**
 * Remove user identity from subsequent error reports. Call on sign-out
 * and after account deletion so errors aren't attributed to the wrong
 * user (or to a deleted account).
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

/**
 * Capture an error with optional structured context.
 *
 * Use this in service-layer catch blocks INSTEAD of console.warn when
 * the failure is interesting (network call failed, unexpected response
 * shape, etc.). Skip it for expected failures (e.g. "user already
 * reported this review" — that's idempotent business logic, not a bug).
 *
 * Examples:
 *   captureError(err, { service: "reviews", op: "createReview" });
 *   captureError(err, { service: "saved", op: "toggleSaved",
 *                       restaurantId, listType });
 *
 * The `context` becomes a "tag" in Sentry's UI — searchable, filterable.
 * Keep keys short and stable. Don't put long strings or arbitrary user
 * input in here — that's what the error message is for.
 */
export function captureError(
  error: unknown,
  context?: Record<string, string | number | boolean>,
): void {
  // In dev, also log to console so you see the same error in your terminal
  // alongside the regular dev workflow. Don't double-log in production —
  // users don't see console output, and Sentry is the source of truth.
  if (__DEV__) {
    console.warn("[captureError]", error, context);
  }

  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setTag(key, String(value));
      }
    }

    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      // Non-Error throws (strings, numbers, plain objects) — wrap so the
      // dashboard still gets a usable stack.
      Sentry.captureException(new Error(String(error)));
    }
  });
}

/**
 * Add a breadcrumb — a small event that shows up in the timeline leading
 * up to a crash. Use sparingly for important user actions. Sentry already
 * captures navigation + network breadcrumbs automatically; you only need
 * this for app-specific events that matter.
 *
 * Example:
 *   addBreadcrumb("Posted review", { restaurantId, rating });
 */
export function addBreadcrumb(
  message: string,
  data?: Record<string, string | number | boolean>,
): void {
  Sentry.addBreadcrumb({
    message,
    data,
    level: "info",
  });
}
