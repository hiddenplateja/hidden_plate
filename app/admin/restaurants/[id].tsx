// app/admin/restaurants/[id].tsx
// Admin: edit a restaurant (all fields + flags) or delete it.

import { Trash2 } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import {
  RestaurantForm,
  type RestaurantFormValues,
} from "@/components/RestaurantForm";
import {
  deleteRestaurant,
  getRestaurantById,
  updateRestaurant,
} from "@/services/restaurants";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";

export default function AdminEditRestaurant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const { styles, colors } = useThemedStyles(makeStyles);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let active = true;
    getRestaurantById(id)
      .then((r) => {
        if (active) {
          setRestaurant(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        Alert.alert("Couldn't load", "Please try again.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      });
    return () => {
      active = false;
    };
  }, [id, router]);

  const handleSubmit = useCallback(
    async (values: RestaurantFormValues) => {
      if (!id) return;
      await updateRestaurant(id, values);
      Alert.alert("Saved", "Your changes have been saved.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    },
    [id, router],
  );

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert(
      "Delete restaurant?",
      "This permanently removes the listing and its photos. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRestaurant(id);
              router.back();
            } catch (err) {
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ],
    );
  }, [id, router]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader
        title="Edit restaurant"
        right={
          <Pressable
            onPress={handleDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete restaurant"
          >
            <Trash2 size={20} color={colors.error} strokeWidth={2} />
          </Pressable>
        }
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : restaurant ? (
        <RestaurantForm
          admin
          initial={restaurant}
          submitLabel="Save changes"
          onSubmit={handleSubmit}
        />
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  });
}
