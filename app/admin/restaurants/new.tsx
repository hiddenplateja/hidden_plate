// app/admin/restaurants/new.tsx
// Admin: create a restaurant (published by default; flags configurable).

import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import {
  RestaurantForm,
  type RestaurantFormValues,
} from "@/components/RestaurantForm";
import { adminCreateRestaurant } from "@/services/restaurants";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function AdminNewRestaurant() {
  const router = useRouter();
  const { styles } = useThemedStyles(makeStyles);

  const handleSubmit = useCallback(
    async (values: RestaurantFormValues) => {
      await adminCreateRestaurant(values);
      Alert.alert("Restaurant created", "It's now in your list.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    },
    [router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Add restaurant" />
      <RestaurantForm
        admin
        submitLabel="Create restaurant"
        onSubmit={handleSubmit}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  });
}
