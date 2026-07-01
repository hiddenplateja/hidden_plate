// app/(auth)/auth.tsx
// Transient landing for the OAuth deep-link redirect
// (appwrite-callback-<projectId>://auth). On a native build that redirect also
// surfaces in the router; without a matching route it flashed "Unmatched
// Route" before sign-in finished. Living in the (auth) group means the root
// auth-gate treats it as part of the sign-in flow (no bounce to /login). The
// OAuth handler creates the session and navigates on from here — to the
// username picker for new users, or the gate sends returning users to the tabs
// — so this only ever shows a brief spinner.

import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/theme/ThemeProvider";

export default function OAuthCallbackScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.cardBackground }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
