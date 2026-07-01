// app/admin/restaurants/index.tsx
// Admin: browse/search ALL restaurants (active + pending), filter by status,
// tap to edit, or add a new one.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import {
  listAdminRestaurants,
  type AdminRestaurantStatus,
} from "@/services/restaurants";
import { getImagePreviewUrl } from "@/services/storage";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import { getLocationLine } from "@/utils/restaurantDisplay";

const STATUS_TABS: { key: AdminRestaurantStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
];

export default function AdminRestaurantsList() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminRestaurantStatus>("all");
  const [items, setItems] = useState<Restaurant[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  // Refresh when returning from add/edit.
  useFocusEffect(
    useCallback(() => {
      setFocusTick((t) => t + 1);
    }, []),
  );

  // Debounced load on query/status/focus.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await listAdminRestaurants({ search: query, status });
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, status, focusTick]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const page = await listAdminRestaurants({
        search: query,
        status,
        cursor,
      });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // keep what we have
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, query, status, cursor]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader
        title="Restaurants"
        right={
          <Pressable
            onPress={() => router.push("/admin/restaurants/new")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add restaurant"
          >
            <MaterialCommunityIcons
              name="plus"
              size={24}
              color={colors.primary}
            />
          </Pressable>
        }
      />

      {/* Search + status filter */}
      <View style={styles.filters}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons
            name="magnify"
            size={18}
            color={colors.textSecondary}
          />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search restaurants…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <MaterialCommunityIcons
                name="close-circle"
                size={16}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.tabs}>
          {STATUS_TABS.map((tab) => {
            const isActive = status === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setStatus(tab.key)}
                style={[styles.tab, isActive && styles.tabActive]}
              >
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RestaurantRow
              restaurant={item}
              onPress={() =>
                router.push({
                  pathname: "/admin/restaurants/[id]",
                  params: { id: item.id },
                })
              }
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No restaurants found.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function RestaurantRow({
  restaurant,
  onPress,
}: {
  restaurant: Restaurant;
  onPress: () => void;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const thumb = coverId ? getImagePreviewUrl(coverId) : null;
  const location = getLocationLine(restaurant);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <MaterialCommunityIcons
            name="silverware-fork-knife"
            size={18}
            color={colors.textMuted}
          />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {restaurant.name}
        </Text>
        {location ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {location}
          </Text>
        ) : null}
        <View style={styles.badges}>
          {!restaurant.isActive ? (
            <Badge label="Pending" tone="warn" />
          ) : null}
          {restaurant.isVerified ? (
            <Badge label="Verified" tone="ok" />
          ) : null}
          {restaurant.isFeatured ? (
            <Badge label="Featured" tone="star" />
          ) : null}
        </View>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={colors.textMuted}
      />
    </Pressable>
  );
}

function Badge({ label, tone }: { label: string; tone: "warn" | "ok" | "star" }) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const bg =
    tone === "ok" ? "#E7F7EF" : tone === "star" ? "#FFF7E6" : colors.primaryLight;
  const fg =
    tone === "ok" ? "#0E8A53" : tone === "star" ? "#B8860B" : colors.primary;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  filters: {
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    padding: 0,
  },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  tabLabelActive: { color: colors.textInverse, fontFamily: fonts.bold },

  listContent: { paddingVertical: spacing.sm, paddingBottom: 100 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.cardBackground,
  },
  rowPressed: { backgroundColor: colors.pageBackground },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowName: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  rowSub: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  badges: { flexDirection: "row", gap: spacing.xs, marginTop: 2 },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.huge,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
  },
  footer: { paddingVertical: spacing.lg, alignItems: "center" },
  });
}
