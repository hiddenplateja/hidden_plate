// app/_layout.tsx
// Root layout — runs above every screen.
//
// Responsibilities:
//   1. Initialize Sentry as early as possible (before any other code)
//   2. Wraps tree in <AuthProvider> so any screen can call useAuth()
//   3. Wraps tree in <NotificationProvider> (INSIDE AuthProvider so it can
//      read user state for push registration / cleanup)
//   4. Loads custom fonts (Roboto family) before rendering any screen —
//      prevents the "fonts pop in mid-render" flash that looks unprofessional
//   5. Auth guard: while checking session shows splash; once known,
//      redirects logged-out users to (auth) and logged-in users out of (auth)
//
// Why one guard at the root:
//   - Single place to reason about auth navigation
//   - No flash of protected content
//   - No way to bypass via deep link

import * as Sentry from "@sentry/react-native";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppGateProvider } from "@/components/AppGateProvider";
import { BadgeCelebrationProvider } from "@/components/BadgeCelebrationProvider";
import { NotificationProvider } from "@/components/NotificationProvider";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import { asyncStoragePersister, queryClient } from "@/lib/queryClient";
import { emailVerificationEnabled } from "@/services/auth";
import { useAppFonts } from "@/theme/fonts";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

// Sentry initialization — runs once at app startup, before any render.
//
// Configuration choices:
//   - DSN from env: keeps the value out of source control and lets us swap
//     between projects (or disable in CI by leaving it blank).
//   - sendDefaultPii: true — sends IP/device context with reports. Required
//     for useful debugging; we don't send email/etc. unless we explicitly
//     identify the user via identifyUser() in services/sentry.ts.
//   - Session Replay: OFF. The wizard enabled it at 10% session sampling
//     but it eats free-tier quota fast and we don't need it yet. Re-enable
//     when we're seeing real production bugs that need UI replay context.
//   - Logs: OFF. Same quota concern. We have Appwrite function logs server
//     side and breadcrumbs in Sentry client-side — that's enough for now.
//   - Feedback widget: ON (default config). Users can shake-to-feedback
//     in builds we configure for it. Doesn't cost quota.
//
// If EXPO_PUBLIC_SENTRY_DSN is missing, Sentry is effectively disabled —
// no crashes, no quota burn. Useful for local dev where you don't want
// noise in the dashboard.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  sendDefaultPii: true,
  enableLogs: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  integrations: [Sentry.feedbackIntegration()],
  // Skip Sentry instrumentation in dev unless you're actively debugging.
  // Cuts dev-mode startup time and avoids polluting the dashboard with
  // every reload error.
  enabled: !__DEV__,
});

export default Sentry.wrap(function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: 24 * 60 * 60 * 1000,
            dehydrateOptions: {
              // Skip queries that opt out (meta.persist === false) — e.g. the
              // restaurant-detail query, whose Maps/Sets don't survive JSON.
              shouldDehydrateQuery: (query) =>
                query.meta?.persist !== false &&
                defaultShouldDehydrateQuery(query),
            },
          }}
        >
          <ThemeProvider>
            <AppGateProvider>
              <AuthProvider>
                <NotificationProvider>
                  <ThemedStatusBar />
                  <BadgeCelebrationProvider>
                    <RootNavigator />
                  </BadgeCelebrationProvider>
                </NotificationProvider>
              </AuthProvider>
            </AppGateProvider>
          </ThemeProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
});

// Status bar icons follow the active theme. Inside <ThemeProvider>.
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}

// Inner component so it can call useAuth() — must be inside <AuthProvider>
function RootNavigator() {
  const { user, isAuthenticated, isLoading, needsOnboarding } = useAuth();
  const fontsLoaded = useAppFonts();
  const segments = useSegments();
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    if (isLoading) return; // wait for session check

    const inAuthGroup = segments[0] === "(auth)";
    const onVerify =
      inAuthGroup && (segments as string[])[1] === "verify-email";
    const onOnboarding = segments[0] === "onboarding";
    // Gate authenticated-but-unverified users to the verify screen (only when
    // the feature is enabled — otherwise the flow stays dormant).
    const needsVerify =
      emailVerificationEnabled() &&
      isAuthenticated &&
      user !== null &&
      !user.emailVerified;

    if (!isAuthenticated) {
      // Not logged in but trying to access protected area — bounce to login.
      if (!inAuthGroup) router.replace("/(auth)/login");
    } else if (needsVerify) {
      // Logged in but email not verified — hold them on the verify screen.
      if (!onVerify) router.replace("/(auth)/verify-email");
    } else if (needsOnboarding) {
      // Fresh signup — run the one-time onboarding before entering the app.
      if (!onOnboarding) router.replace("/onboarding");
    } else if (inAuthGroup || onOnboarding) {
      // Authed, verified, onboarded — leave any auth/onboarding screen for home.
      router.replace("/(tabs)");
    }
  }, [user, isAuthenticated, isLoading, needsOnboarding, segments, router]);

  // Wait for both auth check AND fonts before rendering screens.
  // This prevents fonts popping in after content already drew with system fallback.
  if (isLoading || !fontsLoaded) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
