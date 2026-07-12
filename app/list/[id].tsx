// app/list/[id].tsx
// Collection detail — title/description, the restaurants, and Share (deep link).
// Owners get Edit / Make public-private / Delete and a per-spot remove. Opens
// from My Collections, the profile Lists tab, or a shared hiddenplate://list/… link.

import {
  ArrowLeft,
  CloudOff,
  EllipsisVertical,
  Globe,
  Lock,
  Pencil,
  Share2,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react-native";
import * as ExpoLinking from "expo-linking";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DraggableSheet } from "@/components/DraggableSheet";
import { ErrorState } from "@/components/ErrorState";
import { RestaurantWideCard } from "@/components/RestaurantWideCard";
import { useAuth } from "@/hooks/useAuth";
import {
  deleteList,
  getListWithRestaurants,
  removeFromList,
  updateList,
} from "@/services/lists";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";
import type { Restaurant } from "@/types/restaurant";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; list: List; restaurants: Restaurant[] };

export default function ListDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [state, setState] = useState<State>({ status: "loading" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { list, restaurants } = await getListWithRestaurants(id);
      setState({ status: "ready", list, restaurants });
    } catch {
      setState({ status: "error" });
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isOwner =
    state.status === "ready" && !!user && user.id === state.list.ownerId;

  const handleShare = useCallback(async () => {
    if (state.status !== "ready") return;
    const url = ExpoLinking.createURL(`/list/${id}`);
    try {
      await Share.share({
        message: `${state.list.title} — a Hidden Plate JA collection: ${url}`,
        url,
        title: state.list.title,
      });
    } catch {
      // share-sheet dismissal is not an error
    }
  }, [state, id]);

  const handlePressRestaurant = useCallback(
    (rid: string) => router.push(`/restaurant/${rid}`),
    [router],
  );

  const handleToggleVisibility = useCallback(async () => {
    if (state.status !== "ready" || busy) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      const updated = await updateList(id, { isPublic: !state.list.isPublic });
      setState((p) => (p.status === "ready" ? { ...p, list: updated } : p));
    } catch (e) {
      Alert.alert(
        "Couldn't update",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [state, busy, id]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    Alert.alert("Delete collection?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteList(id);
            router.back();
          } catch (e) {
            Alert.alert(
              "Couldn't delete",
              e instanceof Error ? e.message : "Try again.",
            );
          }
        },
      },
    ]);
  }, [id, router]);

  const handleRemove = useCallback(
    async (rid: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const updated = await removeFromList(id, rid);
        setState((p) =>
          p.status === "ready"
            ? {
                ...p,
                list: updated,
                restaurants: p.restaurants.filter((r) => r.id !== rid),
              }
            : p,
        );
      } catch (e) {
        Alert.alert(
          "Couldn't remove",
          e instanceof Error ? e.message : "Try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, id],
  );

  const header = (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        style={styles.iconBtn}
      >
        <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2.2} />
      </Pressable>
      <View style={styles.topRight}>
        <Pressable onPress={handleShare} hitSlop={10} style={styles.iconBtn}>
          <Share2 size={20} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
        {isOwner ? (
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Collection options"
          >
            <EllipsisVertical
              size={20}
              color={colors.textPrimary}
              strokeWidth={2}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  if (state.status === "loading") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === "error") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {header}
        <ErrorState
          variant="screen"
          icon={CloudOff}
          title="Couldn't load this collection"
          body="It may be private or no longer exist."
          onRetry={load}
        />
      </SafeAreaView>
    );
  }

  const { list, restaurants } = state;
  const count = list.restaurantIds.length;

  const listHeader = (
    <View style={styles.headerBlock}>
      <View style={styles.visRow}>
        {list.isPublic ? (
          <Globe size={13} color={colors.textMuted} strokeWidth={2} />
        ) : (
          <Lock size={13} color={colors.textMuted} strokeWidth={2} />
        )}
        <Text style={styles.visText}>
          {list.isPublic ? "Public collection" : "Private collection"}
        </Text>
      </View>
      <Text style={styles.title}>{list.title}</Text>
      {list.description ? (
        <Text style={styles.desc}>{list.description}</Text>
      ) : null}
      <Text style={styles.count}>
        {count} {count === 1 ? "spot" : "spots"}
      </Text>
      <Pressable
        onPress={handleShare}
        style={styles.shareBtn}
        accessibilityRole="button"
      >
        <Share2 size={17} color={colors.onPrimary} strokeWidth={2} />
        <Text style={styles.shareText}>Share</Text>
      </Pressable>
      {isOwner && !list.isPublic ? (
        <Text style={styles.privateHint}>
          Make it public (⋯ menu) so the link opens for others.
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {header}
      <FlatList
        data={restaurants}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index }) => (
          <View style={styles.cardWrap}>
            <RestaurantWideCard
              restaurant={item}
              onPress={handlePressRestaurant}
              animationDelay={index * 50}
            />
            {isOwner ? (
              <Pressable
                onPress={() => handleRemove(item.id)}
                hitSlop={8}
                style={styles.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
              >
                <X size={15} color={colors.textInverse} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </View>
        )}
        ListHeaderComponent={listHeader}
        ItemSeparatorComponent={() => <View style={{ height: spacing.lg }} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <UtensilsCrossed
                size={28}
                color={colors.textPrimary}
                strokeWidth={1.8}
              />
            </View>
            <Text style={styles.emptyTitle}>No spots yet</Text>
            <Text style={styles.emptyBody}>
              {isOwner
                ? "Open any restaurant and tap “Add to a collection.”"
                : "This collection is empty."}
            </Text>
          </View>
        }
      />

      <DraggableSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Pressable
          style={styles.sheetItem}
          onPress={() => {
            setMenuOpen(false);
            router.push({ pathname: "/list/edit/[id]", params: { id } });
          }}
        >
          <Pencil size={20} color={colors.textPrimary} strokeWidth={2} />
          <Text style={styles.sheetItemText}>Edit details</Text>
        </Pressable>
        <Pressable style={styles.sheetItem} onPress={handleToggleVisibility}>
          {list.isPublic ? (
            <Lock size={20} color={colors.textPrimary} strokeWidth={2} />
          ) : (
            <Globe size={20} color={colors.textPrimary} strokeWidth={2} />
          )}
          <Text style={styles.sheetItemText}>
            {list.isPublic ? "Make private" : "Make public"}
          </Text>
        </Pressable>
        <Pressable style={styles.sheetItem} onPress={handleDelete}>
          <Trash2 size={20} color={colors.error} strokeWidth={2} />
          <Text style={[styles.sheetItemText, { color: colors.error }]}>
            Delete collection
          </Text>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={() => setMenuOpen(false)}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </DraggableSheet>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    topRight: { flexDirection: "row", alignItems: "center" },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    headerBlock: {
      paddingHorizontal: spacing.screen,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
    },
    visRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    visText: {
      fontFamily: fonts.medium,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
    },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      marginTop: spacing.xs,
    },
    desc: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      lineHeight: 22,
      marginTop: spacing.xs,
    },
    count: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginTop: spacing.sm,
    },
    shareBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      ...shadows.sm,
    },
    shareText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.onPrimary,
    },
    privateHint: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textAlign: "center",
      marginTop: spacing.sm,
    },
    cardWrap: { position: "relative" },
    removeBtn: {
      position: "absolute",
      top: spacing.sm,
      right: spacing.screen + spacing.sm,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: "rgba(20,20,20,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    listContent: { paddingBottom: 100 },
    empty: {
      alignItems: "center",
      paddingTop: spacing.xxl,
      paddingHorizontal: spacing.xxxl,
      gap: spacing.md,
    },
    emptyIconWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
      textAlign: "center",
    },
    emptyBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
    },
    sheetItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    sheetItemText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    cancelBtn: {
      marginTop: spacing.md,
      paddingVertical: spacing.lg,
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
    },
    cancelText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textSecondary,
    },
  });
}
