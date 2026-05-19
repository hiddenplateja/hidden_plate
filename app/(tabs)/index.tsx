// app/(tabs)/index.tsx
// Home feed — Hidden Plate JA discovery screen.
//
// Design: gray page background, white card sections separated by gray gaps.
// Sections: Featured · Near You · New Restaurants · All Spots feed.
//
// Architecture notes:
//   - Goes through services/restaurants — never touches Appwrite directly.
//   - Live review stats merged in via getReviewStatsForRestaurants
//     (denormalized averageRating/reviewCount on the restaurant doc is stale
//      because no Cloud Function maintains it — see services/reviews.ts).
//   - Notification bell shows unread count via NotificationBell component;
//     taps navigate to /notifications.
//   - "See all" links: Featured → /restaurants/featured · New → /restaurants/new
//   - Cuisine + location line formats from utils/restaurantDisplay —
//     consistent across all cards.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { NotificationBell } from "@/components/NotificationBell";
import { RestaurantSmallCard } from "@/components/RestaurantSmallCard";
import { RestaurantWideCard } from "@/components/RestaurantWideCard";
import { useAuth } from "@/hooks/useAuth";
import { listRestaurants } from "@/services/restaurants";
import { getReviewStatsForRestaurants } from "@/services/reviews";
import { getImagePreviewUrl } from "@/services/storage";
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
import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

const { width: SW } = Dimensions.get("window");

const STAR_COLOR =
  (colors as unknown as Record<string, string>).star ?? "#F4A523";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "all", label: "All", icon: "silverware-fork-knife" },
  { id: "jerk", label: "Jerk", icon: "fire" },
  { id: "seafood", label: "Seafood", icon: "fish" },
  { id: "patties", label: "Patties", icon: "pie" },
  { id: "ital", label: "Ital", icon: "leaf" },
  { id: "sweets", label: "Sweets", icon: "cupcake" },
] as const;

const PAGE_SIZE = 5;
const LOAD_MORE_SIZE = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coverUrl(restaurant: Restaurant): string | null {
  const id = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  return id ? getImagePreviewUrl(id) : null;
}

function primaryCuisine(restaurant: Restaurant): string | null {
  return restaurant.cuisines[0] ?? null;
}

// ─── Animated press-scale wrapper ─────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ScalePressableProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: object;
}

function ScalePressable({ onPress, children, style }: ScalePressableProps) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 15, stiffness: 350 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 350 });
      }}
      onPress={onPress}
      style={[animStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ─── Featured card (large, dark gradient overlay) ────────────────────────────

const FeaturedCard = memo(function FeaturedCard({
  item,
  onPress,
}: {
  item: Restaurant;
  onPress: (id: string) => void;
}) {
  const handlePress = useCallback(() => onPress(item.id), [item.id, onPress]);
  const url = coverUrl(item);
  const cuisine = primaryCuisine(item); // for the cuisine badge in the top-left
  const cuisineLine = getCuisineLine(item);
  const locationLine = getLocationLine(item);

  return (
    <ScalePressable onPress={handlePress} style={featuredStyles.card}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, featuredStyles.placeholder]}>
          <MaterialCommunityIcons
            name="silverware-fork-knife"
            size={32}
            color={colors.border}
          />
        </View>
      )}

      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.78)"]}
        style={featuredStyles.gradient}
      />

      {cuisine ? (
        <View style={featuredStyles.cuisineBadge}>
          <Text style={featuredStyles.cuisineBadgeText}>
            {cuisine.toUpperCase()}
          </Text>
        </View>
      ) : null}

      <View style={featuredStyles.content}>
        <Text style={featuredStyles.name} numberOfLines={1}>
          {item.name}
        </Text>

        {item.reviewCount > 0 ? (
          <View style={featuredStyles.ratingRow}>
            <MaterialCommunityIcons
              name="star"
              size={13}
              color={colors.cardBackground}
            />
            <Text style={featuredStyles.ratingValue}>
              {item.averageRating.toFixed(1)}
            </Text>
            <Text style={featuredStyles.ratingCount}>({item.reviewCount})</Text>
          </View>
        ) : (
          <Text style={featuredStyles.noReviews} numberOfLines={1}>
            New listing, no reviews
          </Text>
        )}

        {cuisineLine ? (
          <Text style={featuredStyles.subDetail} numberOfLines={1}>
            {cuisineLine}
          </Text>
        ) : null}

        {locationLine ? (
          <Text style={featuredStyles.locationText} numberOfLines={1}>
            {locationLine}
          </Text>
        ) : null}
      </View>
    </ScalePressable>
  );
});

// ─── Category chip ───────────────────────────────────────────────────────────

function CategoryChip({
  item,
  isActive,
  onPress,
}: {
  item: (typeof CATEGORIES)[number];
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[chipStyles.chip, isActive && chipStyles.chipActive]}
    >
      <MaterialCommunityIcons
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={item.icon as any}
        size={14}
        color={isActive ? colors.textInverse : colors.textMuted}
        style={{ marginRight: 5 }}
      />
      <Text style={[chipStyles.label, isActive && chipStyles.labelActive]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

// ─── "See all" button (right side of a section header) ──────────────────────

function SeeAllButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={screenStyles.seeAllBtn}
      accessibilityRole="button"
      accessibilityLabel="See all"
    >
      <Text style={screenStyles.seeAllText}>See all</Text>
      <MaterialCommunityIcons
        name="chevron-right"
        size={16}
        color={colors.primary}
      />
    </Pressable>
  );
}

// ─── Home screen ─────────────────────────────────────────────────────────────

interface UserLocation {
  latitude: number;
  longitude: number;
}

export default function HomeFeedScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [featuredRestaurants, setFeaturedRestaurants] = useState<Restaurant[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [allPage, featuredPage] = await Promise.all([
        listRestaurants({ pageSize: 50, sort: "recent" }),
        listRestaurants({
          pageSize: 10,
          sort: "rating",
          filters: { featured: true },
        }),
      ]);

      const allIds = [
        ...allPage.items.map((r) => r.id),
        ...featuredPage.items.map((r) => r.id),
      ];
      const statsMap = await getReviewStatsForRestaurants(allIds);

      const merge = (r: Restaurant): Restaurant => {
        const stats = statsMap.get(r.id);
        return stats
          ? { ...r, averageRating: stats.average, reviewCount: stats.count }
          : r;
      };

      setRestaurants(allPage.items.map(merge));
      setFeaturedRestaurants(featuredPage.items.map(merge));
    } catch (err) {
      console.error("[home] fetch failed:", err);
      Alert.alert(
        "Couldn't load",
        err instanceof Error ? err.message : "Try pulling down to refresh.",
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError(true);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setLocationError(false);
    } catch {
      setLocationError(true);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    requestLocation();
  }, [fetchAll, requestLocation]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setVisibleCount(PAGE_SIZE);
    fetchAll();
  }, [fetchAll]);

  const loadMore = useCallback(() => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((prev) => prev + LOAD_MORE_SIZE);
      setIsLoadingMore(false);
    }, 300);
  }, [isLoadingMore]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, activeCategory]);

  const nearbyRestaurants = useMemo(() => {
    if (!userLocation) return [];
    return restaurants
      .map((r) => ({
        ...r,
        distance: getDistanceKm(
          userLocation.latitude,
          userLocation.longitude,
          r.latitude,
          r.longitude,
        ),
      }))
      .filter((r) => r.distance <= 20)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
  }, [restaurants, userLocation]);

  const filteredRestaurants = useMemo(() => {
    let list = restaurants;
    if (activeCategory !== "all") {
      const cat = activeCategory.toLowerCase();
      list = list.filter(
        (r) =>
          r.cuisines.some((c) => c.toLowerCase() === cat) ||
          r.categories.some((c) => c.toLowerCase() === cat),
      );
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.cuisines.some((c) => c.toLowerCase().includes(q)) ||
          r.categories.some((c) => c.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [restaurants, searchQuery, activeCategory]);

  const newRestaurants = useMemo(() => restaurants.slice(0, 5), [restaurants]);

  const paginatedRestaurants = useMemo(
    () => filteredRestaurants.slice(0, visibleCount),
    [filteredRestaurants, visibleCount],
  );
  const hasMore = visibleCount < filteredRestaurants.length;

  const handlePress = useCallback(
    (id: string) => router.push(`/restaurant/${id}`),
    [router],
  );

  const handleSeeAllFeatured = useCallback(
    () => router.push("/restaurants/featured"),
    [router],
  );

  const handleSeeAllNew = useCallback(
    () => router.push("/restaurants/new"),
    [router],
  );

  const handleBellPress = useCallback(() => {
    router.push("/notifications");
  }, [router]);

  const renderFeedItem = useCallback(
    ({ item, index }: { item: Restaurant; index: number }) => (
      <RestaurantWideCard
        restaurant={item}
        onPress={handlePress}
        animationDelay={index * 60}
      />
    ),
    [handlePress],
  );

  const renderListHeader = useCallback(
    () => (
      <View>
        {/* Featured */}
        {!searchQuery &&
        activeCategory === "all" &&
        featuredRestaurants.length > 0 ? (
          <View style={screenStyles.sectionBlock}>
            <View style={screenStyles.sectionRow}>
              <Text style={screenStyles.sectionTitle}>Featured</Text>
              <SeeAllButton onPress={handleSeeAllFeatured} />
            </View>
            <FlatList
              horizontal
              data={featuredRestaurants}
              keyExtractor={(item) => `feat-${item.id}`}
              renderItem={({ item }) => (
                <FeaturedCard item={item} onPress={handlePress} />
              )}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={screenStyles.horizontalListContent}
              snapToInterval={size.featuredCardWidth + spacing.md}
              decelerationRate="fast"
            />
          </View>
        ) : null}

        {/* Near You */}
        {!searchQuery && activeCategory === "all" ? (
          <View style={screenStyles.sectionBlock}>
            <View style={screenStyles.sectionRow}>
              <View style={screenStyles.sectionTitleRow}>
                <Text style={screenStyles.sectionTitle}>Near You</Text>
                {userLocation ? (
                  <View style={screenStyles.locationPill}>
                    <MaterialCommunityIcons
                      name="map-marker"
                      size={10}
                      color={colors.primary}
                    />
                    <Text style={screenStyles.locationPillText}>Live</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {!userLocation && !locationError ? (
              <View style={screenStyles.locationLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={screenStyles.locationLoadingText}>
                  Getting your location…
                </Text>
              </View>
            ) : null}

            {locationError ? (
              <Pressable
                style={screenStyles.locationDenied}
                onPress={requestLocation}
              >
                <MaterialCommunityIcons
                  name="map-marker-off"
                  size={20}
                  color={colors.textMuted}
                />
                <Text style={screenStyles.locationDeniedText}>
                  Location access needed
                </Text>
                <Text style={screenStyles.locationDeniedSub}>
                  Tap to enable
                </Text>
              </Pressable>
            ) : null}

            {userLocation &&
            !locationError &&
            nearbyRestaurants.length === 0 ? (
              <View style={screenStyles.locationDenied}>
                <MaterialCommunityIcons
                  name="map-search"
                  size={20}
                  color={colors.textMuted}
                />
                <Text style={screenStyles.locationDeniedText}>
                  No spots within 20km
                </Text>
              </View>
            ) : null}

            {nearbyRestaurants.length > 0 ? (
              <FlatList
                horizontal
                data={nearbyRestaurants}
                keyExtractor={(item) => `nearby-${item.id}`}
                renderItem={({ item }) => (
                  <RestaurantSmallCard
                    restaurant={item}
                    distance={item.distance}
                    onPress={handlePress}
                  />
                )}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={screenStyles.horizontalListContent}
              />
            ) : null}
          </View>
        ) : null}

        {/* New Restaurants */}
        {!searchQuery &&
        activeCategory === "all" &&
        newRestaurants.length > 0 ? (
          <View style={screenStyles.sectionBlock}>
            <View style={screenStyles.sectionRow}>
              <View style={screenStyles.sectionTitleRow}>
                <Text style={screenStyles.sectionTitle}>New Restaurants</Text>
                <View style={screenStyles.newBadge}>
                  <Text style={screenStyles.newBadgeText}>NEW</Text>
                </View>
              </View>
              <SeeAllButton onPress={handleSeeAllNew} />
            </View>
            <FlatList
              horizontal
              data={newRestaurants}
              keyExtractor={(item) => `new-${item.id}`}
              renderItem={({ item }) => (
                <RestaurantSmallCard
                  restaurant={item}
                  hideDistance
                  onPress={handlePress}
                />
              )}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={screenStyles.horizontalListContent}
            />
          </View>
        ) : null}

        {/* All Spots header */}
        <View style={screenStyles.allSpotsHeader}>
          <Text style={screenStyles.sectionTitle}>
            {searchQuery
              ? "Results"
              : activeCategory !== "all"
                ? CATEGORIES.find((c) => c.id === activeCategory)?.label
                : "All Spots"}
          </Text>
          <Text style={screenStyles.countText}>
            {filteredRestaurants.length} places
          </Text>
        </View>
      </View>
    ),
    [
      searchQuery,
      activeCategory,
      featuredRestaurants,
      nearbyRestaurants,
      newRestaurants,
      filteredRestaurants.length,
      userLocation,
      locationError,
      handlePress,
      handleSeeAllFeatured,
      handleSeeAllNew,
      requestLocation,
    ],
  );

  if (isLoading) {
    return (
      <View style={screenStyles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={screenStyles.loadingText}>Finding the best spots…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={screenStyles.container} edges={["top"]}>
      <Animated.View
        entering={FadeIn.duration(400)}
        style={screenStyles.header}
      >
        <View style={screenStyles.headerTopRow}>
          <View>
            <Text style={screenStyles.appName}>Hidden Plate</Text>
            <Text style={screenStyles.tagline}>
              Discover Jamaica&apos;s best eats
            </Text>
          </View>

          {/* Notification bell — shows unread count badge automatically */}
          <NotificationBell onPress={handleBellPress} />
        </View>

        <View style={screenStyles.searchBar}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={colors.textMuted}
            style={{ marginRight: spacing.sm }}
          />
          <TextInput
            style={screenStyles.searchInput}
            placeholder="Search restaurants, cuisines…"
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

        <FlatList
          horizontal
          data={CATEGORIES}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={screenStyles.chipsContent}
          renderItem={({ item }) => (
            <CategoryChip
              item={item}
              isActive={activeCategory === item.id}
              onPress={() => setActiveCategory(item.id)}
            />
          )}
        />
      </Animated.View>

      <View style={screenStyles.headerDivider} />

      <FlatList
        data={paginatedRestaurants}
        keyExtractor={(item) => item.id}
        renderItem={renderFeedItem}
        ListHeaderComponent={renderListHeader}
        contentContainerStyle={screenStyles.feedContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        style={screenStyles.feedList}
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListFooterComponent={
          hasMore ? (
            <Pressable
              style={screenStyles.loadMoreBtn}
              onPress={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={screenStyles.loadMoreText}>Load more places</Text>
              )}
            </Pressable>
          ) : (
            <View style={{ height: spacing.xl }} />
          )
        }
        ListEmptyComponent={
          <Animated.View
            entering={FadeInDown.springify()}
            style={screenStyles.emptyContainer}
          >
            <View style={screenStyles.emptyIconWrap}>
              <MaterialCommunityIcons
                name="silverware-fork-knife"
                size={32}
                color={colors.primary}
              />
            </View>
            <Text style={screenStyles.emptyTitle}>No spots found</Text>
            <Text style={screenStyles.emptySubtitle}>
              Try adjusting your search or browse a different category
            </Text>
          </Animated.View>
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const screenStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.pageBackground },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: T.size.subDetail,
    color: colors.textMuted,
  },

  header: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerDivider: { height: 1, backgroundColor: colors.divider },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  appName: {
    fontFamily: fonts.black,
    fontSize: T.size.xxxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  tagline: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    marginTop: 2,
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
  chipsContent: { gap: spacing.sm, paddingBottom: spacing.xs },

  feedList: { backgroundColor: colors.pageBackground },
  feedContent: { paddingTop: spacing.sm, paddingBottom: 100 },

  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    marginBottom: spacing.lg,
  },
  allSpotsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    marginBottom: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  countText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  horizontalListContent: {
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },

  sectionBlock: {
    backgroundColor: colors.cardBackground,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    marginBottom: spacing.sm,
  },

  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
  },
  seeAllText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },

  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    gap: 3,
  },
  locationPillText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
  },
  locationLoading: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  locationLoadingText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  locationDenied: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  locationDeniedText: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  locationDeniedSub: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.primary,
  },

  newBadge: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  newBadgeText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textInverse,
    letterSpacing: T.tracking.wider,
  },

  loadMoreBtn: {
    marginHorizontal: spacing.screen,
    marginTop: spacing.lg,
    marginBottom: 100,
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.primary,
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: spacing.huge,
    gap: spacing.md,
    paddingHorizontal: spacing.xxxl,
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
    letterSpacing: T.tracking.tight,
  },
  emptySubtitle: {
    fontFamily: fonts.regular,
    fontSize: T.size.subDetail,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: T.leading.normal,
  },
});

const featuredStyles = StyleSheet.create({
  card: {
    width: size.featuredCardWidth,
    height: size.featuredCardHeight,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.pageBackground,
    ...shadows.md,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
  },
  gradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "70%",
  },
  cuisineBadge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  cuisineBadgeText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textInverse,
    letterSpacing: T.tracking.wider,
  },
  content: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    gap: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textInverse,
    letterSpacing: T.tracking.snug,
    marginBottom: 2,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  ratingValue: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cardBackground,
  },
  ratingCount: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: "rgba(255,255,255,0.72)",
  },
  noReviews: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: "rgba(255,255,255,0.72)",
    fontStyle: "italic",
  },
  subDetail: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: "rgba(255,255,255,0.82)",
    textTransform: "capitalize",
  },
  locationText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
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
