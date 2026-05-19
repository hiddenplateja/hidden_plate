// app/_layout.tsx
// Root layout — runs above every screen.
//
// Responsibilities:
//   1. Wraps tree in <AuthProvider> so any screen can call useAuth()
//   2. Wraps tree in <NotificationProvider> (INSIDE AuthProvider so it can
//      read user state for push registration / cleanup)
//   3. Loads custom fonts (Roboto family) before rendering any screen —
//      prevents the "fonts pop in mid-render" flash that looks unprofessional
//   4. Auth guard: while checking session shows splash; once known,
//      redirects logged-out users to (auth) and logged-in users out of (auth)
//
// Why one guard at the root:
//   - Single place to reason about auth navigation
//   - No flash of protected content
//   - No way to bypass via deep link

import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NotificationProvider } from "@/components/NotificationProvider";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import { colors } from "@/theme/colors";
import { useAppFonts } from "@/theme/fonts";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <NotificationProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </NotificationProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Inner component so it can call useAuth() — must be inside <AuthProvider>
function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const fontsLoaded = useAppFonts();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return; // wait for session check

    const inAuthGroup = segments[0] === "(auth)";

    if (!isAuthenticated && !inAuthGroup) {
      // Not logged in but trying to access protected area — bounce to login
      router.replace("/(auth)/login");
    } else if (isAuthenticated && inAuthGroup) {
      // Logged in but on an auth screen — go home
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, isLoading, segments, router]);

  // Wait for both auth check AND fonts before rendering screens.
  // This prevents fonts popping in after content already drew with system fallback.
  if (isLoading || !fontsLoaded) {
    return (
      <View style={styles.splash}>
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
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
