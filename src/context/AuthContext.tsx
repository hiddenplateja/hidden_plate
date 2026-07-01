// src/context/AuthContext.tsx
// Single source of truth for auth state across the app.

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { checkIsAdmin } from "@/services/admin";
import * as authService from "@/services/auth";
import { clearUser, identifyUser } from "@/services/sentry";
import { getUserPreferences } from "@/services/userPreferences";
import type { LoginInput, SignupInput, User } from "@/types/user";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True when the signed-in user belongs to the admins team. */
  isAdmin: boolean;
  /** True for a fresh signup that hasn't finished/skipped onboarding yet. */
  needsOnboarding: boolean;
  login: (input: LoginInput) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<authService.OAuthResult>;
  loginWithApple: () => Promise<authService.OAuthResult>;
  /** Finish a first-time OAuth signup once the user picks a username. */
  completeOAuthSignup: (input: authService.OAuthProfileInput) => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Restore session on app start
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await authService.getCurrentUser();
        if (cancelled) return;
        setUser(me);
        // Tag subsequent Sentry errors with this user. Restored sessions
        // count — if a user reopens the app and something crashes, we
        // want to know it was them.
        if (me) {
          identifyUser({ id: me.id, username: me.username });
          // Resolve admin status before clearing isLoading so the /admin
          // gate has a settled value on app reopen.
          const admin = await checkIsAdmin();
          if (!cancelled) setIsAdmin(admin);
          // Onboarding flag (set at signup) — gates a fresh account into the
          // onboarding flow, even if the app was killed mid-onboarding.
          const prefs = await getUserPreferences();
          if (!cancelled) setNeedsOnboarding(prefs.onboardingPending);
        } else {
          setIsAdmin(false);
          setNeedsOnboarding(false);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setIsAdmin(false);
          setNeedsOnboarding(false);
          clearUser();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload the onboarding flag from account.prefs after an auth change, so the
  // root gate can route a fresh signup into onboarding.
  const refreshOnboarding = useCallback(() => {
    getUserPreferences()
      .then((p) => setNeedsOnboarding(p.onboardingPending))
      .catch(() => setNeedsOnboarding(false));
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const u = await authService.login(input);
    setUser(u);
    identifyUser({ id: u.id, username: u.username });
    checkIsAdmin()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
    refreshOnboarding();
  }, [refreshOnboarding]);

  const signup = useCallback(async (input: SignupInput) => {
    const u = await authService.signup(input);
    setUser(u);
    identifyUser({ id: u.id, username: u.username });
    checkIsAdmin()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
    refreshOnboarding();
  }, [refreshOnboarding]);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setIsAdmin(false);
    setNeedsOnboarding(false);
    clearUser();
  }, []);

  // OAuth sign-in returns a result: "authenticated" sets the user here;
  // "needs-username" leaves the user null (session exists, no profile yet) so
  // the screen can route to the username picker → completeOAuthSignup.
  const loginWithGoogle = useCallback(async (): Promise<authService.OAuthResult> => {
    const res = await authService.loginWithGoogle();
    if (res.status === "authenticated") {
      setUser(res.user);
      identifyUser({ id: res.user.id, username: res.user.username });
      checkIsAdmin()
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false));
      refreshOnboarding();
    }
    return res;
  }, [refreshOnboarding]);

  const loginWithApple = useCallback(async (): Promise<authService.OAuthResult> => {
    const res = await authService.loginWithApple();
    if (res.status === "authenticated") {
      setUser(res.user);
      identifyUser({ id: res.user.id, username: res.user.username });
      checkIsAdmin()
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false));
      refreshOnboarding();
    }
    return res;
  }, [refreshOnboarding]);

  const completeOAuthSignup = useCallback(
    async (input: authService.OAuthProfileInput) => {
      const u = await authService.completeOAuthSignup(input);
      setUser(u);
      identifyUser({ id: u.id, username: u.username });
      checkIsAdmin()
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false));
      refreshOnboarding();
    },
    [refreshOnboarding],
  );

  const refresh = useCallback(async () => {
    const me = await authService.getCurrentUser();
    setUser(me);
    if (me) {
      checkIsAdmin()
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false));
      refreshOnboarding();
    } else {
      setIsAdmin(false);
      setNeedsOnboarding(false);
    }
  }, [refreshOnboarding]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      isAdmin,
      needsOnboarding,
      login,
      signup,
      logout,
      loginWithGoogle,
      loginWithApple,
      completeOAuthSignup,
      refresh,
    }),
    [
      user,
      isLoading,
      isAdmin,
      needsOnboarding,
      login,
      signup,
      logout,
      loginWithGoogle,
      loginWithApple,
      completeOAuthSignup,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
