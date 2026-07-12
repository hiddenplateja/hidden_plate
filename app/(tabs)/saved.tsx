// app/(tabs)/saved.tsx
// Saved tab — three sub-tabs for Favorites / Want to Go / Visited.
//
// Per-tab features (filters reset on tab change):
//   - Search bar (toggled via search icon in header — hidden by default)
//   - Category chips (Jerk, Seafood, Patties, Ital, Sweets) + a City chip
//     that opens a picker sheet listing cities you've actually saved in
//   - Sort dropdown (Newest saved, Recently added, Highest rated, A→Z)
//
// Architecture:
//   - listSavedRestaurants returns saved docs with restaurant data hydrated.
//   - Live review stats merged in via getReviewStatsForRestaurants
//     (denormalized averageRating/reviewCount on the restaurant doc is stale).
//   - Laid out as a 2-column grid of RestaurantSmallCard (compact image + info).
//   - Reload on focus to catch new saves from detail screen.
//
// Visuals match Community: whole screen is one white surface, sub-tabs
// use the underline style (icon + text, grey when inactive, bold + blue
// underline when active). Filters sit directly under the tab row.
//
// Failure handling:
//   When the primary fetch fails we show ErrorState with retry — same
//   pattern as Community + restaurant detail. Pre-patch, this was the
//   worst silent failure in the app: an offline user would see "No
//   favorites yet" identical to a brand-new user, making them think
//   their saves had vanished.

import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowDownAZ,
  ArrowUpDown,
  Bookmark,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  CloudOff,
  Earth,
  Heart,
  Library,
  MapPin,
  Search,
  Star,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryChips, TileChip } from "@/components/CategoryChips";
import { DraggableSheet } from "@/components/DraggableSheet";
import { ErrorState } from "@/components/ErrorState";
import {
  RestaurantSmallCard,
  RestaurantSmallCardSkeleton,
} from "@/components/RestaurantSmallCard";
import { useSavedRestaurants, type SavedItem } from "@/hooks/useSaved";
import { listsEnabled } from "@/services/lists";
import { type ListType } from "@/services/saved";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TabConfig {
  type: ListType;
  label: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyBody: string;
}

type SortKey = "newest_saved" | "recent_added" | "rating" | "name";

interface SortOption {
  key: SortKey;
  label: string;
  icon: LucideIcon;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS: TabConfig[] = [
  {
    type: "favorite",
    label: "Favorites",
    icon: Heart,
    emptyTitle: "No favorites yet",
    emptyBody:
      "Tap the heart on any restaurant to add it here for quick access.",
  },
  {
    type: "want_to_go",
    label: "Want to Go",
    icon: Bookmark,
    emptyTitle: "Nothing bookmarked yet",
    emptyBody:
      "Found a spot you want to try? Tap the bookmark to save it for later.",
  },
  {
    type: "visited",
    label: "Visited",
    icon: CircleCheck,
    emptyTitle: "No visits yet",
    emptyBody:
      "Mark restaurants as visited to keep track of where you've eaten.",
  },
];

const SORT_OPTIONS: SortOption[] = [
  { key: "newest_saved", label: "Newest saved", icon: Clock },
  { key: "recent_added", label: "Recently added", icon: CalendarPlus },
  { key: "rating", label: "Highest rated", icon: Star },
  { key: "name", label: "A to Z", icon: ArrowDownAZ },
];

// Stable empty fallback so the filter memos don't churn while a tab loads.
const EMPTY_SAVED: SavedItem[] = [];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavedScreen() {
  const router = useRouter();
  const searchInputRef = useRef<TextInput>(null);

  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const initialTab: ListType =
    tab === "want_to_go" || tab === "visited" ? tab : "favorite";
  const [activeTab, setActiveTab] = useState<ListType>(initialTab);

  // Saved list via React Query: cached per tab + offline-persisted, refetched
  // on focus to catch saves made elsewhere. A failed refresh keeps stale items.
  const savedQuery = useSavedRestaurants(activeTab);
  const items = savedQuery.data ?? EMPTY_SAVED;
  const loading =
    savedQuery.isPending || (savedQuery.isFetching && !savedQuery.data);
  const refreshing = savedQuery.isRefetching;

  // Filter state — resets on tab change
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("newest_saved");
  const [sortPickerOpen, setSortPickerOpen] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const { styles, colors } = useThemedStyles(makeStyles);

  // Two-column grid: each card fills half the row minus the page padding and
  // the inter-card gap.
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = (windowWidth - spacing.screen * 2 - spacing.md) / 2;

  const { refetch: refetchSaved } = savedQuery;

  // Refetch on focus to catch saves toggled on the detail screen. Deduped with
  // the initial mount fetch by React Query.
  useFocusEffect(
    useCallback(() => {
      refetchSaved();
    }, [refetchSaved]),
  );

  const handleTabChange = useCallback(
    (type: ListType) => {
      if (type === activeTab) return;
      setActiveTab(type); // new query key → React Query loads (or serves cache)
      // Reset all filters when changing tabs
      setSearchQuery("");
      setSearchVisible(false);
      setActiveCategory("all");
      setCityFilter(null);
      setSortKey("newest_saved");
    },
    [activeTab],
  );

  const handleRefresh = useCallback(() => {
    refetchSaved();
  }, [refetchSaved]);

  const handleRetry = handleRefresh;

  const handleRowPress = useCallback(
    (restaurantId: string) => {
      router.push(`/restaurant/${restaurantId}`);
    },
    [router],
  );

  const handleSearchToggle = useCallback(() => {
    setSearchVisible((prev) => {
      const next = !prev;
      if (next) {
        // Focus the input shortly after the animation starts
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        // Hiding the bar clears any active query
        setSearchQuery("");
      }
      return next;
    });
  }, []);

  // Cities derived from saved restaurants in this tab.
  // Deduped + sorted alphabetically. Empty strings ignored.
  const availableCities = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.restaurant?.city && item.restaurant.city.trim()) {
        set.add(item.restaurant.city.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Apply search + category + city + sort to the items.
  const filteredItems = useMemo(() => {
    let list = items.filter((item) => item.restaurant !== null);

    if (activeCategory !== "all") {
      const cat = activeCategory.toLowerCase();
      list = list.filter((item) => {
        const r = item.restaurant!;
        return (
          r.cuisines.some((c) => c.toLowerCase() === cat) ||
          r.categories.some((c) => c.toLowerCase() === cat)
        );
      });
    }

    if (cityFilter) {
      list = list.filter(
        (item) =>
          item.restaurant!.city?.trim().toLowerCase() ===
          cityFilter.toLowerCase(),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((item) => {
        const r = item.restaurant!;
        return (
          r.name.toLowerCase().includes(q) ||
          r.cuisines.some((c) => c.toLowerCase().includes(q)) ||
          r.categories.some((c) => c.toLowerCase().includes(q))
        );
      });
    }

    const sorted = [...list];
    switch (sortKey) {
      case "newest_saved":
        sorted.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        break;
      case "recent_added":
        sorted.sort((a, b) =>
          b.restaurant!.createdAt.localeCompare(a.restaurant!.createdAt),
        );
        break;
      case "rating":
        sorted.sort(
          (a, b) => b.restaurant!.averageRating - a.restaurant!.averageRating,
        );
        break;
      case "name":
        sorted.sort((a, b) =>
          a.restaurant!.name.localeCompare(b.restaurant!.name),
        );
        break;
    }
    return sorted;
  }, [items, searchQuery, activeCategory, cityFilter, sortKey]);

  const currentTabConfig = TABS.find((t) => t.type === activeTab)!;
  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? "Sort";
  const isGenuinelyEmpty = items.length === 0;
  // Show the error screen when we have nothing to fall back on. Stale
  // items + a failed refresh keeps the stale items visible (loadError is
  // only set when items were empty).
  const showError = !loading && savedQuery.isError && items.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Page header — centered title with search toggle on the right */}
      <View style={styles.pageHeader}>
        <View style={styles.headerTopRow}>
          {/* Left: My Collections (balances the right search icon) */}
          <View style={styles.headerSide}>
            {listsEnabled() ? (
              <Pressable
                onPress={() => router.push("/list")}
                style={styles.headerIconBtn}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="My collections"
              >
                <Library size={20} color={colors.textPrimary} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.pageTitle}>My Lists</Text>

          <View style={styles.headerSide}>
            {!isGenuinelyEmpty && !showError ? (
              <Pressable
                onPress={handleSearchToggle}
                style={[
                  styles.headerIconBtn,
                  searchVisible && styles.headerIconBtnActive,
                ]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={
                  searchVisible ? "Close search" : "Open search"
                }
              >
                {searchVisible ? (
                  <X size={20} color={colors.onPrimary} strokeWidth={2.2} />
                ) : (
                  <Search
                    size={20}
                    color={colors.textPrimary}
                    strokeWidth={2.2}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Sub-tabs — underline style matching Community */}
      <View style={styles.tabsBar}>
        {TABS.map((tab) => {
          const isActive = tab.type === activeTab;
          return (
            <Pressable
              key={tab.type}
              onPress={() => handleTabChange(tab.type)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.tabLabelRow}>
                <tab.icon
                  size={14}
                  color={isActive ? colors.textPrimary : colors.textMuted}
                  strokeWidth={isActive ? 2.4 : 2}
                />
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </View>
              <View
                style={[
                  styles.tabUnderline,
                  isActive && styles.tabUnderlineActive,
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Filters — only show when list isn't empty and we're not in error */}
      {!loading && !isGenuinelyEmpty && !showError ? (
        <View style={styles.filtersWrap}>
          {/* Search bar (animated in/out) */}
          {searchVisible ? (
            <Animated.View
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.searchBar}
            >
              <Search
                size={19}
                color={colors.textSecondary}
                strokeWidth={2.2}
                style={{ marginRight: spacing.sm }}
              />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder={`Search ${currentTabConfig.label.toLowerCase()}…`}
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
            </Animated.View>
          ) : null}

          {/* Category chips + a trailing City filter tile */}
          <CategoryChips
            activeId={activeCategory}
            onSelect={setActiveCategory}
            trailing={
              availableCities.length > 0 ? (
                <TileChip
                  icon={MapPin}
                  label={cityFilter ?? "City"}
                  active={!!cityFilter}
                  onPress={() => setCityPickerOpen(true)}
                />
              ) : null
            }
          />

          {/* Count + sort row */}
          <View style={styles.sortRow}>
            <Text style={styles.countText}>
              {filteredItems.length}{" "}
              {filteredItems.length === 1 ? "spot" : "spots"}
            </Text>
            <Pressable
              onPress={() => setSortPickerOpen(true)}
              style={styles.sortBtn}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Change sort order"
            >
              <ArrowUpDown size={14} color={colors.white} strokeWidth={2.2} />
              <Text style={styles.sortBtnLabel}>{currentSortLabel}</Text>
              <ChevronDown size={13} color={colors.white} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
      ) : null}
      {/* Content */}
      {showError ? (
        <ErrorState
          variant="screen"
          icon={CloudOff}
          title="Couldn't load your saved spots"
          body="Check your connection and try again."
          onRetry={handleRetry}
        />
      ) : loading ? (
        // Skeleton grid — small-card placeholders in the same 2-column layout
        // (same horizontal padding + gap) so cards land where skeletons sat.
        <View style={styles.skeletonGrid}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <RestaurantSmallCardSkeleton key={i} width={cardWidth} />
          ))}
        </View>
      ) : isGenuinelyEmpty ? (
        <View style={styles.center}>
          <View style={styles.emptyIconWrap}>
            <currentTabConfig.icon
              size={30}
              color={colors.textPrimary}
              strokeWidth={1.8}
            />
          </View>
          <Text style={styles.emptyTitle}>{currentTabConfig.emptyTitle}</Text>
          <Text style={styles.emptyBody}>{currentTabConfig.emptyBody}</Text>
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIconWrap}>
            <Search size={30} color={colors.textPrimary} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyBody}>
            Try a different search, category, or city.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.savedId}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          renderItem={({ item }) => (
            <RestaurantSmallCard
              restaurant={item.restaurant!}
              onPress={handleRowPress}
              width={cardWidth}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
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
      )}

      {/* Sort picker sheet */}
      <DraggableSheet
        visible={sortPickerOpen}
        onClose={() => setSortPickerOpen(false)}
      >
        <Text style={styles.modalTitle}>Sort by</Text>
        {SORT_OPTIONS.map((option) => {
          const isActive = sortKey === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                setSortKey(option.key);
                setSortPickerOpen(false);
              }}
              style={[styles.modalOption, isActive && styles.modalOptionActive]}
            >
              <option.icon
                size={18}
                color={isActive ? colors.primary : colors.textSecondary}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.modalOptionLabel,
                  isActive && styles.modalOptionLabelActive,
                ]}
              >
                {option.label}
              </Text>
              {isActive ? (
                <Check
                  size={18}
                  color={colors.primary}
                  strokeWidth={2.4}
                  style={{ marginLeft: "auto" }}
                />
              ) : null}
            </Pressable>
          );
        })}
      </DraggableSheet>

      {/* City picker sheet */}
      <DraggableSheet
        visible={cityPickerOpen}
        onClose={() => setCityPickerOpen(false)}
      >
        <Text style={styles.modalTitle}>Filter by city</Text>

        <Pressable
          onPress={() => {
            setCityFilter(null);
            setCityPickerOpen(false);
          }}
          style={[
            styles.modalOption,
            cityFilter === null && styles.modalOptionActive,
          ]}
        >
          <Earth
            size={18}
            color={cityFilter === null ? colors.primary : colors.textSecondary}
            strokeWidth={2}
          />
          <Text
            style={[
              styles.modalOptionLabel,
              cityFilter === null && styles.modalOptionLabelActive,
            ]}
          >
            All cities
          </Text>
          {cityFilter === null ? (
            <Check
              size={18}
              color={colors.primary}
              strokeWidth={2.4}
              style={{ marginLeft: "auto" }}
            />
          ) : null}
        </Pressable>

        {availableCities.map((city) => {
          const isActive = cityFilter === city;
          return (
            <Pressable
              key={city}
              onPress={() => {
                setCityFilter(city);
                setCityPickerOpen(false);
              }}
              style={[styles.modalOption, isActive && styles.modalOptionActive]}
            >
              <MapPin
                size={18}
                color={isActive ? colors.primary : colors.textSecondary}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.modalOptionLabel,
                  isActive && styles.modalOptionLabelActive,
                ]}
              >
                {city}
              </Text>
              {isActive ? (
                <Check
                  size={18}
                  color={colors.primary}
                  strokeWidth={2.4}
                  style={{ marginLeft: "auto" }}
                />
              ) : null}
            </Pressable>
          );
        })}
      </DraggableSheet>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Whole screen is one surface — matches Community
  safe: { flex: 1, backgroundColor: colors.cardBackground },

  // Header — same surface as the rest now
  pageHeader: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    textAlign: "center",
  },
  headerSide: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  headerIconBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  // Underline-style tab bar — text + icon, hairline divider beneath.
  // Mirrors the Community tab bar structure exactly.
  tabsBar: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.md,
    paddingBottom: 0,
  },
  tabLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: spacing.sm,
  },
  tabLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  tabLabelActive: {
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  // Underline bar — same height always (transparent when inactive) so
  // the label position doesn't jump on selection.
  tabUnderline: {
    height: 3,
    width: 36,
    borderRadius: 2,
    backgroundColor: "transparent",
  },
  tabUnderlineActive: {
    backgroundColor: colors.primary,
  },

  // Filters wrap — no top border, the tab bar's hairline already serves as
  // the divider above. Bottom border for visual separation from list.
  filtersWrap: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // Elevated white pill — matches the search bar on the home (index) page.
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
  sortRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing.xs,
  },
  countText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  sortBtnLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.white,
  },

  listContent: {
    paddingTop: spacing.md,
    paddingBottom: 100,
  },
  // One grid row: page padding on the sides, a gap between the two cards, and
  // bottom spacing before the next row.
  columnWrapper: {
    paddingHorizontal: spacing.screen,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  // Mirrors the real grid's padding + gap so skeletons land where cards will.
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: spacing.md,
    paddingHorizontal: spacing.screen,
    gap: spacing.md,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxxl,
    gap: spacing.md,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
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
    paddingHorizontal: spacing.lg,
  },

  // Modal sheets (sort + city) — the sheet chrome (backdrop, rounded sheet,
  // drag handle) now lives in DraggableSheet; only the inner content styles
  // remain here.
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  modalOptionActive: {
    backgroundColor: colors.primaryLight,
  },
  modalOptionLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  modalOptionLabelActive: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  });
}
