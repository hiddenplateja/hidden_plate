// src/components/AddToListSheet.tsx
// Bottom sheet to add/remove a restaurant to/from the user's Collections.
// Loads the user's lists when opened; a check marks the ones already containing
// this restaurant; tapping toggles (optimistic). "+ New collection" routes to
// the create screen seeded with this restaurant.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { addToList, listMyLists, removeFromList } from "@/services/lists";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";

interface AddToListSheetProps {
  visible: boolean;
  restaurantId: string;
  onClose: () => void;
}

export function AddToListSheet({
  visible,
  restaurantId,
  onClose,
}: AddToListSheetProps) {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [lists, setLists] = useState<List[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setError(null);
    listMyLists()
      .then((ls) => active && setLists(ls))
      .catch((e) =>
        active &&
        setError(e instanceof Error ? e.message : "Couldn't load collections."),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [visible]);

  const toggle = useCallback(
    async (list: List) => {
      if (busyId) return;
      const has = list.restaurantIds.includes(restaurantId);
      setBusyId(list.id);
      // Optimistic update of just this list's membership.
      setLists(
        (prev) =>
          prev?.map((l) =>
            l.id === list.id
              ? {
                  ...l,
                  restaurantIds: has
                    ? l.restaurantIds.filter((r) => r !== restaurantId)
                    : [...l.restaurantIds, restaurantId],
                }
              : l,
          ) ?? prev,
      );
      try {
        if (has) await removeFromList(list.id, restaurantId);
        else await addToList(list.id, restaurantId);
      } catch (e) {
        // Revert on failure.
        setLists((prev) => prev?.map((l) => (l.id === list.id ? list : l)) ?? prev);
        Alert.alert(
          "Couldn't update",
          e instanceof Error ? e.message : "Try again.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [busyId, restaurantId],
  );

  const createNew = useCallback(() => {
    onClose();
    router.push({ pathname: "/list/new", params: { restaurantId } });
  }, [onClose, router, restaurantId]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Add to collection</Text>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : lists && lists.length > 0 ? (
            <ScrollView
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              {lists.map((list) => {
                const has = list.restaurantIds.includes(restaurantId);
                return (
                  <Pressable
                    key={list.id}
                    onPress={() => toggle(list)}
                    style={styles.row}
                    accessibilityRole="button"
                    accessibilityState={{ selected: has }}
                  >
                    <MaterialCommunityIcons
                      name={list.isPublic ? "earth" : "lock"}
                      size={16}
                      color={colors.textMuted}
                    />
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {list.title}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {list.restaurantIds.length}{" "}
                        {list.restaurantIds.length === 1 ? "spot" : "spots"}
                      </Text>
                    </View>
                    {busyId === list.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <MaterialCommunityIcons
                        name={has ? "check-circle" : "checkbox-blank-circle-outline"}
                        size={24}
                        color={has ? colors.primary : colors.border}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.empty}>
              You don&apos;t have any collections yet. Create your first one.
            </Text>
          )}

          <Pressable
            style={styles.newRow}
            onPress={createNew}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="plus-circle-outline"
              size={22}
              color={colors.primary}
            />
            <Text style={styles.newText}>New collection</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: Platform.OS === "ios" ? 40 : spacing.xl,
      maxHeight: "75%",
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      alignSelf: "center",
      marginBottom: spacing.lg,
    },
    title: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    scroll: { flexGrow: 0 },
    center: { paddingVertical: spacing.xxl, alignItems: "center" },
    error: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.error,
      paddingVertical: spacing.lg,
      textAlign: "center",
    },
    empty: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textMuted,
      paddingVertical: spacing.lg,
      textAlign: "center",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rowText: { flex: 1 },
    rowTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    rowMeta: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      marginTop: 2,
    },
    newRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
      marginTop: spacing.xs,
    },
    newText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.primary,
    },
  });
}
