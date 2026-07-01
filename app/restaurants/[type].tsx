// app/restaurants/[type].tsx
// "See all" list screen — vertical scroll of image-first restaurant cards.
//
// Routes:
//   /restaurants/featured  → editorial picks (isFeatured = true)
//   /restaurants/new       → recently added (sorted by $createdAt desc)
//
// Features:
//   - Search bar (filters by name + cuisines + categories)
//   - Category chips (Jerk, Seafood, etc — same as home)
//   - Pull to refresh
//   - Infinite scroll
//   - Live review stats merged in (denormalized values are stale)
//
// Search and category filters apply WITHIN the current "See all" category.
// e.g., on /restaurants/featured + Jerk chip = featured jerk spots only.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryChips } from "@/components/CategoryChips";
import { RestaurantImageCard } from "@/components/RestaurantImageCard";
import { listRestaurants } from "@/services/restaurants";
import { getReviewStatsForRestaurants } from "@/services/reviews";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type {
  Restaurant,
  RestaurantFilters,
  RestaurantSort,
} from "@/types/restaurant";

const PAGE_SIZE = 20;

// ─── Type configuration ──────────────────────────────────────────────────────
interface TypeConfig {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyBody: string;
  searchPlaceholder: string;
  filters: RestaurantFilters;
  sort: RestaurantSort;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  featured: {
    title: "Featured Spots",
    subtitle: "Curated by Hidden Plate",
    emptyTitle: "No featured spots yet",
    emptyBody:
      "We're working on highlighting the best places. Check back soon.",
    searchPlaceholder: "Search featured spots…",
    filters: { featured: true },
    sort: "rating",
  },
  new: {
    title: "Newly Added",
    subtitle: "Fresh discoveries",
    emptyTitle: "No new spots yet",
    emptyBody: "New restaurants will appear here as they're added.",
    searchPlaceholder: "Search new spots…",
    filters: {},
    sort: "recent",
  },
};

interface Data {
  items: Restaurant[];
  nextCursor: string | null;
  hasMore: boolean;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Data };

// ─── Helper: merge live review stats into a list of restaurants ──────────────
async function mergeLiveStats(items: Restaurant[]): Promise<Restaurant[]> {
  if (items.length === 0) return items;
  const statsMap = await getReviewStatsForRestaurants(items.map((r) => r.id));
  return items.map((r) => {
    const stats = statsMap.get(r.id);
    return stats
      ? { ...r, averageRating: stats.average, reviewCount: stats.count }
      : r;
  });
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RestaurantListScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const router = useRouter();
  const config = TYPE_CONFIG[type ?? ""];
  const { styles, colors } = useThemedStyles(makeStyles);

  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const load = useCallback(
    async (isRefresh = false) => {
      if (!config) {
        setState({ status: "error", message: "Unknown category." });
        return;
      }
      if (!isRefresh) setState({ status: "loading" });
      try {
        const page = await listRestaurants({
          pageSize: PAGE_SIZE,
          sort: config.sort,
          filters: config.filters,
        });
        const merged = await mergeLiveStats(page.items);
        setState({
          status: "ready",
          data: {
            items: merged,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load.",
        });
      } finally {
        setRefreshing(false);
      }
    },
    [config],
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const handleLoadMore = useCallback(async () => {
    if (state.status !== "ready" || !state.data.hasMore || loadingMore) return;
    if (!config) return;
    setLoadingMore(true);
    try {
      const page = await listRestaurants({
        pageSize: PAGE_SIZE,
        sort: config.sort,
        filters: config.filters,
        cursor: state.data.nextCursor,
      });
      const merged = await mergeLiveStats(page.items);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: {
            items: [...prev.data.items, ...merged],
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        };
      });
    } catch (err) {
      console.warn("[restaurant-list] load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [state, loadingMore, config]);

  const handleRestaurantPress = useCallback(
    (restaurantId: string) => {
      router.push(`/restaurant/${restaurantId}`);
    },
    [router],
  );

  // Apply search + category filters CLIENT-SIDE to the already-loaded items.
  // (We're filtering within the loaded page, same pattern as the home screen.)
  const filteredItems = useMemo(() => {
    if (state.status !== "ready") return [];
    let list = state.data.items;

    if (activeCategory !== "all") {
      const cat = activeCategory.toLowerCase();
      list = list.filter(
        (r) =>
          r.cuisines.some((c) => c.toLowerCase() === cat) ||
          r.categories.some((c) => c.toLowerCase() === cat),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.cuisines.some((c) => c.toLowerCase().includes(q)) ||
          r.categories.some((c) => c.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [state, activeCategory, searchQuery]);

  // ─── Unknown type fallback ──────────────────────────────────────────────

  if (!config) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header title="Not found" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Unknown category</Text>
          <Text style={styles.errorMessage}>
            We couldn&apos;t find that category. It may have been removed.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loading state ──────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header
          title={config.title}
          subtitle={config.subtitle}
          onBack={() => router.back()}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error state ────────────────────────────────────────────────────────

  if (state.status === "error") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header
          title={config.title}
          subtitle={config.subtitle}
          onBack={() => router.back()}
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Couldn&apos;t load</Text>
          <Text style={styles.errorMessage}>{state.message}</Text>
          <Pressable onPress={() => load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Ready state ────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header
        title={config.title}
        subtitle={config.subtitle}
        count={filteredItems.length}
        onBack={() => router.back()}
      />

      {/* Search + chips */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={colors.textSecondary}
            style={{ marginRight: spacing.sm }}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={config.searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>

        <CategoryChips
          activeId={activeCategory}
          onSelect={setActiveCategory}
          compact
          contentContainerStyle={styles.chipsContent}
        />
      </View>

      <View style={styles.divider} />

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <RestaurantImageCard
              restaurant={item}
              onPress={handleRestaurantPress}
            />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons
                name={
                  searchQuery || activeCategory !== "all"
                    ? "magnify"
                    : "silverware-clean"
                }
                size={32}
                color={colors.primary}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery || activeCategory !== "all"
                ? "No matches"
                : config.emptyTitle}
            </Text>
            <Text style={styles.emptyBody}>
              {searchQuery || activeCategory !== "all"
                ? "Try a different search or category."
                : config.emptyBody}
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
}

// ─── Header component ───────────────────────────────────────────────────────

function Header({
  title,
  subtitle,
  count,
  onBack,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  onBack: () => void;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <MaterialCommunityIcons
          name="arrow-left"
          size={22}
          color={colors.textPrimary}
        />
      </Pressable>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
            {typeof count === "number"
              ? ` · ${count} ${count === 1 ? "spot" : "spots"}`
              : ""}
          </Text>
        ) : null}
      </View>
      <View style={{ width: 36 }} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  searchWrap: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  // Elevated white pill — matches the home (index) page search bar.
  searchBar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    padding: 0,
  },
  chipsContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },

  divider: { height: 1, backgroundColor: colors.border },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
  },
  errorMessage: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },

  listContent: {
    paddingTop: spacing.md,
    paddingBottom: 100,
  },
  cardWrap: {
    paddingHorizontal: spacing.screen,
  },

  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing.huge,
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

  footerLoader: {
    paddingVertical: spacing.lg,
  },
  });
}
