// app/list/index.tsx
// "My Collections" — the user's own lists, with a New-collection action.
// Reached from the Saved tab header. Cover images are hydrated here and passed
// to ListCard.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { ListCard } from "@/components/ListCard";
import { listMyLists } from "@/services/lists";
import { getRestaurantsByIds } from "@/services/restaurants";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; lists: List[]; covers: Map<string, string | null> };

export default function MyCollectionsScreen() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setState({ status: "loading" });
    try {
      const lists = await listMyLists();
      const coverIds = lists
        .map((l) => l.coverRestaurantId ?? l.restaurantIds[0] ?? null)
        .filter((x): x is string => !!x);
      const covers = new Map<string, string | null>();
      if (coverIds.length > 0) {
        const restMap = await getRestaurantsByIds(coverIds);
        for (const l of lists) {
          const rid = l.coverRestaurantId ?? l.restaurantIds[0] ?? null;
          const r = rid ? restMap.get(rid) : null;
          covers.set(l.id, r?.coverImageId ?? r?.imageIds[0] ?? null);
        }
      }
      setState({ status: "ready", lists, covers });
    } catch {
      setState({ status: "error" });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const openList = useCallback(
    (id: string) => router.push({ pathname: "/list/[id]", params: { id } }),
    [router],
  );
  const createNew = useCallback(() => router.push("/list/new"), [router]);

  const header = (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        style={styles.backBtn}
      >
        <MaterialCommunityIcons
          name="arrow-left"
          size={24}
          color={colors.textPrimary}
        />
      </Pressable>
      <Text style={styles.topTitle}>My Collections</Text>
      <Pressable
        onPress={createNew}
        hitSlop={10}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="New collection"
      >
        <MaterialCommunityIcons name="plus" size={26} color={colors.primary} />
      </Pressable>
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
          icon="cloud-off-outline"
          title="Couldn't load your collections"
          body="Check your connection and try again."
          onRetry={() => load()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {header}
      <FlatList
        data={state.lists}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <ListCard
            list={item}
            coverImageId={state.covers.get(item.id)}
            onPress={openList}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons
                name="bookmark-multiple-outline"
                size={32}
                color={colors.primary}
              />
            </View>
            <Text style={styles.emptyTitle}>No collections yet</Text>
            <Text style={styles.emptyBody}>
              Group spots into shareable lists like &ldquo;Best jerk in
              Kingston.&rdquo;
            </Text>
            <Pressable
              onPress={createNew}
              style={styles.createBtn}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="plus"
                size={18}
                color={colors.textInverse}
              />
              <Text style={styles.createText}>New collection</Text>
            </Pressable>
          </View>
        }
      />
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
    backBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    topTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
    listContent: { paddingVertical: spacing.sm, paddingBottom: 100 },
    empty: {
      alignItems: "center",
      paddingTop: spacing.huge,
      paddingHorizontal: spacing.xxxl,
      gap: spacing.md,
    },
    emptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
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
    createBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    createText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textInverse,
    },
  });
}
