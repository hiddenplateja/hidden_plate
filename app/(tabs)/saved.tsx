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
//   - Each row uses RestaurantImageCard (full-bleed image + overlay).
//   - Reload on focus to catch new saves from detail screen.
//
// Visuals match Community: whole screen is one white surface, sub-tabs
// use the underline style (icon + text, grey when inactive, bold + blue
// underline when active). Filters sit directly under the tab row.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { RestaurantImageCard } from "@/components/RestaurantImageCard";
import { getReviewStatsForRestaurants } from "@/services/reviews";
import { listSavedRestaurants, type ListType } from "@/services/saved";
import {
  colors,
  fonts,
  radius,
  shadows,
  size,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { Restaurant } from "@/types/restaurant";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SavedItem {
  savedId: string;
  /** When this saved doc was created (used for "Newest saved" sort) */
  savedAt: string;
  restaurant: Restaurant | null;
}

interface TabConfig {
  type: ListType;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  emptyTitle: string;
  emptyBody: string;
}

type SortKey = "newest_saved" | "recent_added" | "rating" | "name";

interface SortOption {
  key: SortKey;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS: TabConfig[] = [
  {
    type: "favorite",
    label: "Favorites",
    icon: "heart-outline",
    emptyTitle: "No favorites yet",
    emptyBody:
      "Tap the heart on any restaurant to add it here for quick access.",
  },
  {
    type: "want_to_go",
    label: "Want to Go",
    icon: "bookmark-outline",
    emptyTitle: "Nothing bookmarked yet",
    emptyBody:
      "Found a spot you want to try? Tap the bookmark to save it for later.",
  },
  {
    type: "visited",
    label: "Visited",
    icon: "check-circle-outline",
    emptyTitle: "No visits yet",
    emptyBody:
      "Mark restaurants as visited to keep track of where you've eaten.",
  },
];

const CATEGORIES = [
  { id: "all", label: "All", icon: "silverware-fork-knife" },
  { id: "jerk", label: "Jerk", icon: "fire" },
  { id: "seafood", label: "Seafood", icon: "fish" },
  { id: "patties", label: "Patties", icon: "pie" },
  { id: "ital", label: "Ital", icon: "leaf" },
  { id: "sweets", label: "Sweets", icon: "cupcake" },
] as const;

const SORT_OPTIONS: SortOption[] = [
  { key: "newest_saved", label: "Newest saved", icon: "clock-outline" },
  { key: "recent_added", label: "Recently added", icon: "calendar-plus" },
  { key: "rating", label: "Highest rated", icon: "star" },
  { key: "name", label: "A to Z", icon: "sort-alphabetical-ascending" },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavedScreen() {
  const router = useRouter();
  const searchInputRef = useRef<TextInput>(null);

  const [activeTab, setActiveTab] = useState<ListType>("favorite");
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter state — resets on tab change
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("newest_saved");
  const [sortPickerOpen, setSortPickerOpen] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  const load = useCallback(async (type: ListType, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const results = await listSavedRestaurants(type);

      // Collect IDs of restaurants that loaded successfully, fetch live stats
      const validRestaurants = results
        .map((r) => r.restaurant)
        .filter((r): r is Restaurant => r !== null);
      const statsMap =
        validRestaurants.length > 0
          ? await getReviewStatsForRestaurants(
              validRestaurants.map((r) => r.id),
            )
          : new Map();

      // Merge stats into restaurant objects
      setItems(
        results.map((r) => ({
          savedId: r.saved.id,
          savedAt: r.saved.createdAt,
          restaurant: r.restaurant
            ? (() => {
                const stats = statsMap.get(r.restaurant.id);
                return stats
                  ? {
                      ...r.restaurant,
                      averageRating: stats.average,
                      reviewCount: stats.count,
                    }
                  : r.restaurant;
              })()
            : null,
        })),
      );
    } catch (err) {
      console.warn("[saved] load failed:", err);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the screen gains focus
  useFocusEffect(
    useCallback(() => {
      load(activeTab);
    }, [load, activeTab]),
  );

  const handleTabChange = useCallback(
    (type: ListType) => {
      if (type === activeTab) return;
      setActiveTab(type);
      setItems([]);
      // Reset all filters when changing tabs
      setSearchQuery("");
      setSearchVisible(false);
      setActiveCategory("all");
      setCityFilter(null);
      setSortKey("newest_saved");
      load(type);
    },
    [activeTab, load],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load(activeTab, true);
  }, [activeTab, load]);

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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Page header — centered title with search toggle on the right */}
      <View style={styles.pageHeader}>
        <View style={styles.headerTopRow}>
          {/* Left spacer — balances the right icon so the title is truly centered */}
          <View style={styles.headerSide} />

          <Text style={styles.pageTitle}>My Lists</Text>

          <View style={styles.headerSide}>
            {!isGenuinelyEmpty ? (
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
                <MaterialCommunityIcons
                  name={searchVisible ? "close" : "magnify"}
                  size={22}
                  color={
                    searchVisible ? colors.textInverse : colors.textPrimary
                  }
                />
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
                <MaterialCommunityIcons
                  name={tab.icon}
                  size={15}
                  color={isActive ? colors.textPrimary : colors.textMuted}
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

      {/* Filters — only show when list isn't empty */}
      {!loading && !isGenuinelyEmpty ? (
        <View style={styles.filtersWrap}>
          {/* Search bar (animated in/out) */}
          {searchVisible ? (
            <Animated.View
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.searchBar}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={20}
                color={colors.textMuted}
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
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
              ) : null}
            </Animated.View>
          ) : null}

          {/* Category + city chips row */}
          <FlatList
            horizontal
            data={CATEGORIES}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
            ListFooterComponent={
              availableCities.length > 0 ? (
                <Pressable
                  onPress={() => setCityPickerOpen(true)}
                  style={[
                    chipStyles.chip,
                    cityFilter && chipStyles.cityChipActive,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="map-marker"
                    size={14}
                    color={cityFilter ? colors.textInverse : colors.primary}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      chipStyles.label,
                      cityFilter && chipStyles.labelActive,
                    ]}
                  >
                    {cityFilter ?? "City"}
                  </Text>
                  <MaterialCommunityIcons
                    name="chevron-down"
                    size={14}
                    color={cityFilter ? colors.textInverse : colors.primary}
                    style={{ marginLeft: 4 }}
                  />
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const isActive = activeCategory === item.id;
              return (
                <Pressable
                  onPress={() => setActiveCategory(item.id)}
                  style={[chipStyles.chip, isActive && chipStyles.chipActive]}
                >
                  <MaterialCommunityIcons
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    name={item.icon as any}
                    size={14}
                    color={isActive ? colors.textInverse : colors.textMuted}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      chipStyles.label,
                      isActive && chipStyles.labelActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
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
              <MaterialCommunityIcons
                name="sort-variant"
                size={16}
                color={colors.primary}
              />
              <Text style={styles.sortBtnLabel}>{currentSortLabel}</Text>
              <MaterialCommunityIcons
                name="chevron-down"
                size={14}
                color={colors.primary}
              />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isGenuinelyEmpty ? (
        <View style={styles.center}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons
              name={currentTabConfig.icon}
              size={32}
              color={colors.primary}
            />
          </View>
          <Text style={styles.emptyTitle}>{currentTabConfig.emptyTitle}</Text>
          <Text style={styles.emptyBody}>{currentTabConfig.emptyBody}</Text>
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons
              name="magnify"
              size={32}
              color={colors.primary}
            />
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
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <RestaurantImageCard
                restaurant={item.restaurant!}
                onPress={handleRowPress}
              />
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
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
      <Modal
        visible={sortPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSortPickerOpen(false)}
        >
          <Pressable
            style={styles.modalSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHandle} />
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
                  style={[
                    styles.modalOption,
                    isActive && styles.modalOptionActive,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={option.icon}
                    size={20}
                    color={isActive ? colors.primary : colors.textSecondary}
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
                    <MaterialCommunityIcons
                      name="check"
                      size={20}
                      color={colors.primary}
                      style={{ marginLeft: "auto" }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* City picker sheet */}
      <Modal
        visible={cityPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCityPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCityPickerOpen(false)}
        >
          <Pressable
            style={styles.modalSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHandle} />
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
              <MaterialCommunityIcons
                name="earth"
                size={20}
                color={
                  cityFilter === null ? colors.primary : colors.textSecondary
                }
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
                <MaterialCommunityIcons
                  name="check"
                  size={20}
                  color={colors.primary}
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
                  style={[
                    styles.modalOption,
                    isActive && styles.modalOptionActive,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="map-marker"
                    size={20}
                    color={isActive ? colors.primary : colors.textSecondary}
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
                    <MaterialCommunityIcons
                      name="check"
                      size={20}
                      color={colors.primary}
                      style={{ marginLeft: "auto" }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Whole screen is white — matches Community
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  chipsContent: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
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
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  sortBtnLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
  },

  listContent: {
    paddingTop: spacing.md,
    paddingBottom: 100,
    paddingHorizontal: 0,
  },
  cardWrap: {
    paddingHorizontal: spacing.screen,
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
    backgroundColor: colors.primaryLight,
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

  // Modal sheets (sort + city)
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.screen,
    ...shadows.md,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
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

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    height: size.chipHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.sm,
  },
  cityChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.sm,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  labelActive: {
    fontFamily: fonts.bold,
    color: colors.textInverse,
  },
});
