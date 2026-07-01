// src/hooks/useGuardedAction.ts
// Wraps an async action so it can't run again while a previous call is still in
// flight. Rapid double-taps (e.g. on an optimistic Follow / Like button) collapse
// to a single request instead of firing N racing calls. Returns the guarded
// callback plus a `busy` flag for disabling UI.
//
// This is a UX / double-submit guard, NOT a security control — it only affects
// this client. Real rate limiting is enforced server-side.

import { useCallback, useRef, useState } from "react";

export function useGuardedAction<A extends unknown[]>(
  action: (...args: A) => Promise<void>,
): { run: (...args: A) => Promise<void>; busy: boolean } {
  // Ref (not state) gates re-entry synchronously, so a second tap in the same
  // tick is dropped before React re-renders.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (...args: A) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        await action(...args);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [action],
  );

  return { run, busy };
}
