// src/hooks/useAsyncData.ts
// Generic loading/data/error state manager for any async fetch.
//
// Replaces the boilerplate that lives in every screen today:
//   - const [data, setData] = useState(null)
//   - const [loading, setLoading] = useState(true)
//   - const [error, setError] = useState(null)
//   - useEffect with try/catch/finally
//   - cancellation logic on unmount
//
// Now:
//   const { data, loading, error, retry } = useAsyncData(
//     () => listReviewsForRestaurant(restaurantId),
//     [restaurantId],
//     { sentryContext: { service: "reviews", op: "listForRestaurant" } },
//   );
//
// Three guarantees:
//   1. Cancellation — if the user navigates away mid-fetch, the result
//      will not call setState on an unmounted component.
//   2. Error reporting — failures are sent to Sentry automatically with
//      the context tags you pass in. No need to wrap every call site.
//   3. Retry — retry() re-runs the fetcher without re-running effects
//      elsewhere. Same fetcher, fresh attempt.
//
// What this hook does NOT do:
//   - Refetch on focus / window blur (not a SWR replacement).
//   - Cache results across mounts.
//   - Debounce / throttle.
// If you need those things, build them on top or reach for a real data
// library. For Hidden Plate's scale, this is enough.

import { useCallback, useEffect, useRef, useState } from "react";

import { captureError } from "@/services/sentry";

interface UseAsyncDataOptions<T> {
  /**
   * Context tags passed to Sentry when the fetcher throws. Useful for
   * filtering errors in the dashboard — e.g. { service: "reviews",
   * op: "listForRestaurant", restaurantId: "abc" }.
   *
   * Keep values short (under ~50 chars) and structured. Don't pass entire
   * objects.
   */
  sentryContext?: Record<string, string | number | boolean>;
  /**
   * Initial data value before the first fetch resolves. Defaults to null.
   * Useful for screens that want to render skeleton + structure
   * immediately, e.g. an empty array.
   */
  initialData?: T | null;
  /**
   * If true, errors are reported to Sentry but never set as `error` state.
   * The screen renders as if the fetch returned the previous data (or
   * initialData). Use for fire-and-forget background loads where an
   * error UI would be jarring.
   */
  silent?: boolean;
  /**
   * If true, the hook does not auto-fetch on mount or when deps change.
   * Useful when you want to defer the first call until the user does
   * something (e.g. tap a tab). Call retry() to trigger it manually.
   *
   * The lazy mode does NOT change retry's behavior — once you call retry
   * the first time, subsequent dep changes will re-fetch normally unless
   * you keep enabled=false.
   */
  enabled?: boolean;
  /**
   * Optional callback invoked when the fetcher resolves successfully.
   * Useful for triggering downstream side effects (analytics, animations)
   * without re-running the fetch.
   */
  onSuccess?: (data: T) => void;
  /**
   * Optional callback invoked when the fetcher throws. The error is
   * still set on `error` state and sent to Sentry; this hook is purely
   * for screen-specific reactions (e.g. toast).
   */
  onError?: (error: Error) => void;
}

interface UseAsyncDataResult<T> {
  /** Latest resolved value, or initialData if not yet fetched. */
  data: T | null;
  /** True while a fetch is in flight (initial or retry). */
  loading: boolean;
  /** Set when the fetcher throws and silent !== true. */
  error: Error | null;
  /** Re-run the fetcher. Resets error to null while in flight. */
  retry: () => void;
}

/**
 * Run an async function on mount and whenever deps change. Manages
 * loading/data/error state with proper cancellation and Sentry reporting.
 *
 * @param fetcher  Function that returns a Promise<T>. Must be stable
 *                 across renders — wrap in useCallback if it captures
 *                 props, OR rely on `deps` to invalidate.
 * @param deps     Dependencies that trigger re-fetch when they change.
 *                 Treated like a useEffect dep array — pass primitives.
 * @param options  Optional configuration. See UseAsyncDataOptions.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options: UseAsyncDataOptions<T> = {},
): UseAsyncDataResult<T> {
  const {
    sentryContext,
    initialData = null,
    silent = false,
    enabled = true,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Cancellation token: bumps on every fetch attempt. Each pending fetch
  // captures the value at the time it started; if the token has changed
  // by the time it resolves, the result is discarded. This handles both
  // unmount AND rapid dep changes (think autocomplete) safely.
  const tokenRef = useRef(0);

  // Run the fetch. Separated from useEffect so retry() can call it
  // directly without re-running the effect's dependency-based scheduling.
  const run = useCallback(() => {
    const myToken = ++tokenRef.current;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (myToken !== tokenRef.current) return; // stale
        setData(result);
        setLoading(false);
        if (onSuccess) onSuccess(result);
      })
      .catch((err: unknown) => {
        if (myToken !== tokenRef.current) return; // stale
        const errorObj = err instanceof Error ? err : new Error(String(err));

        // Always report — Sentry should see every failure even in silent
        // mode. That's the whole reason silent exists: hide from user,
        // show to ops.
        captureError(errorObj, sentryContext);

        setLoading(false);
        if (!silent) {
          setError(errorObj);
        }
        if (onError) onError(errorObj);
      });
    // fetcher is intentionally excluded from deps — its identity isn't
    // stable across renders for many call sites. We re-run via the deps
    // passed in by the caller, plus retry().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silent, onSuccess, onError]);

  // Auto-fetch on mount + when caller's deps change.
  useEffect(() => {
    if (!enabled) return;
    run();
    return () => {
      // Bump the token so any in-flight promise resolves into a no-op.
      // We don't actually cancel the HTTP request — the fetcher would
      // need an AbortSignal for that, and most service calls don't use
      // one. But discarding the result is enough to prevent stale state.
      tokenRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  const retry = useCallback(() => {
    run();
  }, [run]);

  return { data, loading, error, retry };
}
