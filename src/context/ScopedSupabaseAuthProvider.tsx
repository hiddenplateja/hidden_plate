import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthContext, type AuthContextValue } from "@/context/AuthContext";
import * as authService from "@/services/auth";
import { getRuntimeSupabaseServices } from "@/services/backendRuntime";
import { clearUser, identifyUser } from "@/services/sentry";
import { createAuthSnapshotCoordinator } from "@/utils/authSnapshotCoordinator";
import { SIGNED_OUT_SNAPSHOT, type AuthSnapshot } from "@/utils/authSession";

// Memory-only for the first test integration: no private persisted payload is
// hydrated before identity verification, and no throttled old-account disk write
// can race cleanup. Durable scoped offline persistence remains a later test.
function retireQueries(client: QueryClient) {
  // Capture the old queries before clearing. A cancelled fetch's finally block
  // can schedule GC after removal; destroy those detached objects once settled.
  const queries = client.getQueryCache().getAll();
  const cancelled = client.cancelQueries();
  client.clear();
  void cancelled.finally(() => {
    queries.forEach(query => query.destroy());
    client.clear();
  }).catch(() => {});
}
function AccountQueries({ children, onClient }: { children: ReactNode; onClient: (client: QueryClient | null) => void }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 24 * 60 * 60 * 1000, retry: 1 } } }));
  useEffect(() => {
    onClient(client);
    return () => { onClient(null); retireQueries(client); };
  }, [client, onClient]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
export function ScopedSupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ ...SIGNED_OUT_SNAPSHOT });
  const [isLoading, setLoading] = useState(true);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const identity = useRef<string | null>(null);
  const queryCache = useRef<QueryClient | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const commit = useCallback((next: AuthSnapshot) => {
    if (!mounted.current) return;
    const nextId = next.user?.id ?? null;
    if (identity.current !== nextId) {
      identity.current = nextId;
      if (queryCache.current) retireQueries(queryCache.current);
      setScopeEpoch(epoch => epoch + 1);
    }
    setSnapshot(next);
    setLoading(false);
    if (next.user) identifyUser({ id: next.user.id, username: next.user.username }); else clearUser();
  }, []);
  const coordinator = useMemo(() => createAuthSnapshotCoordinator(commit), [commit]);
  const loadSnapshot = useCallback(async () => (await (await getRuntimeSupabaseServices()).gateway.load("auth")).loadSupabaseAuthSnapshot(), []);
  const refresh = useCallback(async () => { await coordinator.refresh(loadSnapshot); }, [coordinator, loadSnapshot]);
  useEffect(() => {
    mounted.current = true;
    coordinator.activate();
    let disposed = false, unsubscribe: (() => void) | undefined;
    void getRuntimeSupabaseServices().then(services => services.gateway.load("auth")).then(async auth => {
      if (disposed) return;
      unsubscribe = auth.subscribeSupabaseAuthSnapshot(next => { if (!disposed) coordinator.publish(next); }, () => {
        // Keep already verified state on a transient refresh error; never adopt
        // a failed/mismatched profile or publish permissions from an old account.
        if (!disposed) setLoading(false);
      });
      await coordinator.refresh(auth.restoreSupabaseAuthSnapshot);
    }).catch(() => { if (!disposed) { coordinator.publish({ ...SIGNED_OUT_SNAPSHOT }); setLoading(false); } });
    return () => { disposed = true; mounted.current = false; coordinator.dispose(); unsubscribe?.(); };
  }, [coordinator]);
  const exclusive = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (busy.current) throw new Error("Another account action is in progress. Please try again.");
    busy.current = true;
    try { return await operation(); } finally { busy.current = false; }
  }, []);
  const login: AuthContextValue["login"] = useCallback(input => exclusive(async () => { await authService.login(input); await refresh(); }), [exclusive, refresh]);
  const signup: AuthContextValue["signup"] = useCallback(input => exclusive(async () => { await authService.signup(input); await refresh(); }), [exclusive, refresh]);
  // Read the authoritative session after the action. A late completion must not
  // clear a newer account that was published while the SDK request was pending.
  const logout = useCallback(() => exclusive(async () => { await authService.logout(); await refresh(); }), [exclusive, refresh]);
  const oauth = useCallback((operation: () => Promise<authService.OAuthResult>) => exclusive(async () => {
    const result = await operation();
    await refresh();
    return result;
  }), [exclusive, refresh]);
  const loginWithGoogle = useCallback(() => oauth(authService.loginWithGoogle), [oauth]);
  const loginWithApple = useCallback(() => oauth(authService.loginWithApple), [oauth]);
  const completeOAuthSignup: AuthContextValue["completeOAuthSignup"] = useCallback(input => exclusive(async () => {
    await authService.completeOAuthSignup(input); await refresh();
  }), [exclusive, refresh]);
  const onClient = useCallback((client: QueryClient | null) => { queryCache.current = client; }, []);
  const value = useMemo<AuthContextValue>(() => ({ ...snapshot, isLoading, isAuthenticated: snapshot.user !== null,
    login, signup, logout, loginWithGoogle, loginWithApple, completeOAuthSignup, refresh,
  }), [snapshot, isLoading, login, signup, logout, loginWithGoogle, loginWithApple, completeOAuthSignup, refresh]);
  return <AuthContext.Provider value={value}><AccountQueries key={scopeEpoch} onClient={onClient}>{children}</AccountQueries></AuthContext.Provider>;
}
