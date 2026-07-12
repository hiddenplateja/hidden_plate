// app/restaurant/[id]/edit-menu.tsx
// Owner-only: edit your restaurant's menu (the owner override). Pre-filled from
// the current effective menu — your saved override, or the admin base menu if
// you haven't set one. Saves to the restaurantMenus collection.
//
// The owner gate here is UX only; the real protection is the per-doc Update
// permission on the menu doc (granted to the owner at claim approval), so a
// non-owner who reached this screen still couldn't save.

import { ArrowLeft } from "lucide-react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { MenuEditor } from "@/components/MenuEditor";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import {
  getOwnerMenu,
  updateMyRestaurantMenu,
} from "@/services/restaurantMenus";
import { getRestaurantById } from "@/services/restaurants";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { MenuSection } from "@/types/restaurant";

export default function EditMenuScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [loading, setLoading] = useState(true);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuSection[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [restaurant, override] = await Promise.all([
          getRestaurantById(id),
          getOwnerMenu(id),
        ]);
        if (!active) return;
        setOwnerId(restaurant.ownerId);
        // Prefill from the effective menu: saved override, else the base menu.
        setMenu(override && override.length > 0 ? override : restaurant.menu);
      } catch {
        if (active) setOwnerId(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const handleSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await updateMyRestaurantMenu(id, menu);
      Alert.alert("Menu saved", "Your menu has been updated.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Try again.",
      );
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Only the verified owner may edit; anyone else is bounced back to the page.
  if (!user?.id || user.id !== ownerId) {
    return <Redirect href={`/restaurant/${id}`} />;
  }

  return (
    <View style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.headerTitle}>Edit menu</Text>
          <View style={{ width: 36 }} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          <Text style={styles.intro}>
            Add sections (e.g. Mains, Drinks) and the dishes in each. This shows
            on your restaurant&apos;s page under &quot;View menu&quot;.
          </Text>
          <MenuEditor value={menu} onChange={setMenu} disabled={submitting} />
          <Button
            label="Save menu"
            onPress={handleSave}
            loading={submitting}
            style={styles.submit}
          />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.md,
      backgroundColor: colors.cardBackground,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    backBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
    content: { padding: spacing.lg, paddingBottom: spacing.huge },
    intro: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    submit: { marginTop: spacing.xl },
  });
}
