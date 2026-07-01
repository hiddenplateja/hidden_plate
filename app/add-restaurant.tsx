// app/add-restaurant.tsx
// Community submission form. Thin wrapper around the shared <RestaurantForm>;
// submissions are created with isActive=false (pending admin approval — see
// createRestaurant) and stay hidden until approved.

import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  RestaurantForm,
  type RestaurantFormValues,
} from "@/components/RestaurantForm";
import { createRestaurant } from "@/services/restaurants";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function AddRestaurantScreen() {
  const router = useRouter();
  const { styles } = useThemedStyles(makeStyles);

  const handleSubmit = useCallback(
    async (values: RestaurantFormValues) => {
      await createRestaurant(values);
      Alert.alert(
        "Submitted for review 🎉",
        "Thanks for the tip! Your restaurant has been sent for approval and will show up once it's been reviewed.",
        [{ text: "Done", onPress: () => router.back() }],
      );
    },
    [router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Add a Restaurant</Text>
        <View style={{ width: 52 }} />
      </View>

      <RestaurantForm
        submitLabel="Submit for review"
        intro="Know a spot that's missing? Add it here. New listings are reviewed before they go live."
        onSubmit={handleSubmit}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  cancel: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.primary,
    width: 52,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  });
}
