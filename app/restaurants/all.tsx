// app/restaurants/all.tsx
// "All Spots" — full browsable restaurant list with numbered pagination.
//
// Reached from Home's All Spots section ("See all" / "View all"). This is a
// static route segment, so it takes precedence over restaurants/[type].tsx
// for the /restaurants/all path — [type].tsx never sees "all".
//
// Why client-side pagination:
//   listRestaurants is cursor-based (forward-only), which can't jump to an
//   arbitrary page. So we pull the whole catalogue once (looping the cursor,
//   capped at MAX_ITEMS), merge live review stats in a single batch, then
//   paginate in memory — giving real page numbers and a Prev/Next pager.
//
// Cards: RestaurantImageCard (image-first, 200px), same as the other
// See-all screens. Search + category chips filter the loaded set; the pager
// runs over the filtered result and resets to page 1 when filters change.
//
// Failure handling matches the current sprint:
//   - Initial load failure with nothing on screen → <ErrorState> + retry.
//   - Refresh failure with data already showing → stale list stays, Sentry
//     captures silently.
//   - Stats are decorative: a stats failure falls back to the (stale)
//     denormalized values rather than failing the whole screen.

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleX,
  CloudOff,
  Search,
} from "lucide-react-native";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { ErrorState } from "@/components/ErrorState";
import {
    RestaurantImageCard,
    RestaurantImageCardSkeleton,
} from "@/components/RestaurantImageCard";
import { useAllRestaurants } from "@/hooks/useRestaurantLists";
import { getTastePreferences } from "@/services/userPreferences";
import {
    fonts,
    radius,
    shadows,
    size,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Parish, Restaurant } from "@/types/restaurant";
import { ALL_SPOTS_SEED, rankAllSpots } from "@/utils/allSpotsRanking";

// 10 cards per page, as requested.
const ITEMS_PER_PAGE = 10;

// Stable empty fallback so memo deps don't churn while the list loads.
const EMPTY_RESTAURANTS: Restaurant[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Builds a windowed page list with ellipses, e.g. [1, "gap", 4, 5, 6, "gap", 12]
function buildPageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "gap")[] = [];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);

  pages.push(1);
  if (left > 2) pages.push("gap");
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < total - 1) pages.push("gap");
  pages.push(total);

  return pages;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AllRestaurantsScreen() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);

  // "All Spots" catalogue via React Query (cached + offline-persisted).
  const query = useAllRestaurants();
  const { refetch } = query;
  const items = query.data ?? EMPTY_RESTAURANTS;
  const loading = query.isPending;
  const refreshing = query.isRefetching;
  const errorMessage =
    query.isError && !query.data
      ? query.error instanceof Error
        ? query.error.message
        : "Check your connection and try again."
      : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Personalization inputs for the blended ordering (taste + location + random).
  const [favoriteCuisines, setFavoriteCuisines] = useState<Set<string>>(
    new Set(),
  );
  const [favoriteParishes, setFavoriteParishes] = useState<Set<Parish>>(
    new Set(),
  );
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  // Seeds the personalized shuffle. Initialized to the app-wide ALL_SPOTS_SEED
  // so this page matches the home preview on first visit. Pull-to-refresh
  // bumps it for a fresh order (preview unaffected — that's the point).
  const [seed, setSeed] = useState<number>(ALL_SPOTS_SEED);

  // Load taste favorites + (already-granted) location once. We never prompt for
  // location from this screen — home handles that — so this stays unobtrusive.
  useEffect(() => {
    let active = true;
    getTastePreferences()
      .then((p) => {
        if (!active) return;
        setFavoriteCuisines(
          new Set(p.favoriteCuisines.map((c) => c.toLowerCase())),
        );
        setFavoriteParishes(new Set(p.favoriteParishes));
      })
      .catch(() => {});
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (active) {
          setUserLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch {
        /* location is optional — rank without it */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const listRef = useRef<FlatList<Restaurant>>(null);

  const handleRefresh = useCallback(() => {
    setSeed(Math.floor(Math.random() * 1_000_000_000));
    refetch();
  }, [refetch]);

  const handleRestaurantPress = useCallback(
    (restaurantId: string) => {
      router.push(`/restaurant/${restaurantId}`);
    },
    [router],
  );

  // Personalized base order: taste (onboarding favorites) + location + a seeded
  // shuffle, with a small quality lift. Replaces plain recency.
  const rankedItems = useMemo(
    () =>
      rankAllSpots(items, {
        favoriteCuisines,
        favoriteParishes,
        userLocation,
        seed,
      }),
    [items, favoriteCuisines, favoriteParishes, userLocation, seed],
  );

  // Search + category filters over the ranked set (same logic as home).
  const filteredItems = useMemo(() => {
    let list = rankedItems;

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
  }, [rankedItems, activeCategory, searchQuery]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / ITEMS_PER_PAGE),
  );

  // Reset to page 1 whenever the filter set changes.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, activeCategory]);

  // Keep the page in range if the filtered set shrinks.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () =>
      filteredItems.slice(
        (safePage - 1) * ITEMS_PER_PAGE,
        safePage * ITEMS_PER_PAGE,
      ),
    [filteredItems, safePage],
  );

  const goToPage = useCallback(
    (next: number) => {
      setPage(Math.max(1, Math.min(next, totalPages)));
    },
    [totalPages],
  );

  // Jump back to the top of the list whenever the page changes.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [safePage]);

  const renderItem = useCallback(
    ({ item }: { item: Restaurant }) => (
      <View style={styles.cardWrap}>
        <RestaurantImageCard
          restaurant={item}
          onPress={handleRestaurantPress}
        />
      </View>
    ),
    [handleRestaurantPress, styles],
  );

  // ─── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header
          title="All Spots"
          subtitle="Every spot on Hidden Plate"
          onBack={() => router.back()}
        />
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.cardWrap}>
              <RestaurantImageCardSkeleton />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error state ──────────────────────────────────────────────────────────

  if (errorMessage) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header
          title="All Spots"
          subtitle="Every spot on Hidden Plate"
          onBack={() => router.back()}
        />
        <ErrorState
          variant="screen"
          icon={CloudOff}
          title="Couldn't load spots"
          body={errorMessage}
          onRetry={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  // ─── Ready state ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header
        title="All Spots"
        subtitle="Every spot on Hidden Plate"
        count={filteredItems.length}
        onBack={() => router.back()}
      />

      {/* Search + chips */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search
            size={19}
            color={colors.textSecondary}
            strokeWidth={2.2}
            style={{ marginRight: spacing.sm }}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search all spots…"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <CircleX size={17} color={colors.textMuted} strokeWidth={2} />
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
        ref={listRef}
        data={pageItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={ITEMS_PER_PAGE}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Search size={30} color={colors.textPrimary} strokeWidth={1.8} />
            </View>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyBody}>
              Try a different search or category.
            </Text>
          </View>
        }
        ListFooterComponent={
          totalPages > 1 ? (
            <Pager
              page={safePage}
              totalPages={totalPages}
              onChange={goToPage}
            />
          ) : (
            <View style={{ height: spacing.xl }} />
          )
        }
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

// ─── Pager ──────────────────────────────────────────────────────────────────

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const window = buildPageWindow(page, totalPages);
  const atStart = page <= 1;
  const atEnd = page >= totalPages;
  const { styles: pagerStyles, colors } = useThemedStyles(makePagerStyles);

  return (
    <View style={pagerStyles.wrap}>
      <View style={pagerStyles.row}>
        <Pressable
          onPress={() => onChange(page - 1)}
          disabled={atStart}
          hitSlop={6}
          style={[pagerStyles.arrow, atStart && pagerStyles.arrowDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Previous page"
        >
          <ChevronLeft
            size={21}
            color={atStart ? colors.textMuted : colors.primary}
            strokeWidth={2.2}
          />
        </Pressable>

        {window.map((p, i) =>
          p === "gap" ? (
            <View key={`gap-${i}`} style={pagerStyles.gap}>
              <Text style={pagerStyles.gapText}>…</Text>
            </View>
          ) : (
            <Pressable
              key={p}
              onPress={() => onChange(p)}
              style={[pagerStyles.page, p === page && pagerStyles.pageActive]}
              accessibilityRole="button"
              accessibilityLabel={`Page ${p}`}
              accessibilityState={{ selected: p === page }}
            >
              <Text
                style={[
                  pagerStyles.pageText,
                  p === page && pagerStyles.pageTextActive,
                ]}
              >
                {p}
              </Text>
            </Pressable>
          ),
        )}

        <Pressable
          onPress={() => onChange(page + 1)}
          disabled={atEnd}
          hitSlop={6}
          style={[pagerStyles.arrow, atEnd && pagerStyles.arrowDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Next page"
        >
          <ChevronRight
            size={21}
            color={atEnd ? colors.textMuted : colors.primary}
            strokeWidth={2.2}
          />
        </Pressable>
      </View>

      <Text style={pagerStyles.summary}>
        Page {page} of {totalPages}
      </Text>
    </View>
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
        <ArrowLeft
          size={20}
          strokeWidth={2.2}
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
  safe: { flex: 1, backgroundColor: colors.cardBackground },

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
  headerText: { flex: 1 },
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

  divider: { height: 1, backgroundColor: colors.divider },

  skeletonList: {
    paddingTop: spacing.md,
    paddingBottom: 100,
    gap: spacing.md,
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
  });
}

function makePagerStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  wrap: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  arrow: {
    width: size.chipHeight,
    height: size.chipHeight,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  arrowDisabled: {
    opacity: 0.5,
  },
  page: {
    minWidth: size.chipHeight,
    height: size.chipHeight,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  pageActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.sm,
  },
  pageText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  pageTextActive: {
    color: colors.onPrimary,
  },
  gap: {
    minWidth: 20,
    height: size.chipHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  gapText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  summary: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  });
}

