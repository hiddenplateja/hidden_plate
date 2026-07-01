// app/admin/_layout.tsx
// Guards every /admin/* route: only members of the admins team get in.
// While auth is still resolving we show a spinner; once settled, non-admins
// are redirected home. Server-side, the collections also grant write access
// only to the admins team — so this is UX gating layered on real security.

import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@/hooks/useAuth";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function AdminLayout() {
  const { isAdmin, isLoading } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!isAdmin) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
  },
  });
}
