// app/(tabs)/index.tsx
// Home feed — Hidden Plate JA discovery screen.
//
// Design: full white page (consistent with Community / Saved / Profile).
// Sections separated by hairline dividers, not gray gaps.
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
//     · All Spots → /restaurants/all
//   - All Spots shows the first 20 only as a preview. The full browsable list
//     (10-per-page pagination, RestaurantImageCard) lives on /restaurants/all.
//   - Cuisine + location line formats from utils/restaurantDisplay —
//     consistent across all cards.
//
// Loading state uses skeletons that match the post-load layout, so the
// transition has zero layout shift. The "Near You" location-fetch step also
// shows skeleton cards while coordinates are being acquired.
//
// Failure handling:
//   - Primary fetch failing with nothing to fall back on → full-screen
//     ErrorState with retry (replaces the old intrusive Alert popup).
//   - Refresh failures when items are already on screen → silent (Sentry
//     captures); the stale list stays visible, user can pull down again.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
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

import { CategoryChips, CATEGORIES } from "@/components/CategoryChips";
import { ErrorState } from "@/components/ErrorState";
import {
  applyHomeFilters,
  countActiveFilters,
  DEFAULT_FILTERS,
  HomeFilterSheet,
  type HomeFilters,
} from "@/components/HomeFilterSheet";
import { NotificationBell } from "@/components/NotificationBell";
import {
  RestaurantSmallCard,
  RestaurantSmallCardSkeleton,
} from "@/components/RestaurantSmallCard";
import { RestaurantWideCard } from "@/components/RestaurantWideCard";
import { Skeleton } from "@/components/Skeleton";
import { SpotOfTheDayHero } from "@/components/SpotOfTheDayHero";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useHomeFeed, useRestaurantSearch } from "@/hooks/useHomeFeed";
import {
  resolveSpotOfTheDay,
  type SpotOfTheDay,
} from "@/services/spotOfTheDay";
import { getImagePreviewUrl } from "@/services/storage";
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
import { getDistanceKm } from "@/utils/distance";
import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

const { width: SW } = Dimensions.get("window");

// ─── Constants ───────────────────────────────────────────────────────────────

// How many All Spots cards to show on Home before sending users to the
// dedicated /restaurants/all page. The full list paginates 10 at a time there.
const ALL_SPOTS_PREVIEW = 20;

// "Hidden Gems" — highly rated but still under the radar (only a handful of
// reviews). On brand for Hidden Plate, and distinct from Featured (paid) and
// New. Derived from the already-loaded feed, so it's free. Tunable thresholds;
// the row hides itself when nothing qualifies (e.g. before any reviews exist).
const GEM_MIN_RATING = 4.3;
const GEM_MIN_REVIEWS = 1;
const GEM_MAX_REVIEWS = 5;
const HIDDEN_GEMS_MAX = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const { styles: featuredStyles, colors } = useThemedStyles(makeFeaturedStyles);
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
              color={colors.star}
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

// ─── "See all" button (right side of a section header) ──────────────────────

function SeeAllButton({ onPress }: { onPress: () => void }) {
  const { styles: screenStyles, colors } = useThemedStyles(makeScreenStyles);
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

// ─── Featured card skeleton — matches FeaturedCard's dimensions ─────────────
// Uses size.featuredCardWidth + size.featuredCardHeight so the skeleton row
// scrolls/snaps identically to the real one.

function FeaturedCardSkeleton() {
  return (
    <Skeleton
      width={size.featuredCardWidth}
      height={size.featuredCardHeight}
      borderRadius={radius.xl}
    />
  );
}

// ─── Full-screen home skeleton — mirrors the post-load layout ───────────────
// Why a full custom skeleton rather than a simple spinner: this is the
// app's entry screen and the first impression. A real-layout skeleton
// makes the load feel substantially faster and prevents the layout shift
// that happens when the spinner is replaced by 600px of structured content.

function HomeSkeleton() {
  const { styles: screenStyles } = useThemedStyles(makeScreenStyles);
  return (
    <SafeAreaView style={screenStyles.container} edges={["top"]}>
      {/* Header — title + tagline + search bar + chips */}
      <View style={screenStyles.header}>
        <View style={screenStyles.headerTopRow}>
          <View>
            <Skeleton width={170} height={28} borderRadius={6} />
            <View style={{ height: 6 }} />
            <Skeleton width={140} height={12} borderRadius={4} />
          </View>
          <Skeleton width={40} height={40} borderRadius={radius.full} />
        </View>

        <Skeleton
          width="100%"
          height={48}
          borderRadius={radius.lg}
          style={{ marginBottom: spacing.md }}
        />

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ width: 68, alignItems: "center" }}>
              <Skeleton width={60} height={60} borderRadius={radius.full} />
              <View style={{ height: spacing.xs }} />
              <Skeleton width={40} height={10} borderRadius={4} />
            </View>
          ))}
        </View>
      </View>

      <View style={screenStyles.headerDivider} />

      {/* Content */}
      <View style={{ flex: 1 }}>
        {/* Featured section */}
        <View style={screenStyles.sectionBlock}>
          <View style={screenStyles.sectionRow}>
            <Skeleton width={110} height={22} borderRadius={4} />
            <Skeleton width={60} height={14} borderRadius={4} />
          </View>
          <View style={screenStyles.horizontalListContent}>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <FeaturedCardSkeleton />
              <FeaturedCardSkeleton />
            </View>
          </View>
        </View>

        {/* Near You section */}
        <View style={screenStyles.sectionBlock}>
          <View style={screenStyles.sectionRow}>
            <Skeleton width={100} height={22} borderRadius={4} />
          </View>
          <View style={screenStyles.horizontalListContent}>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <RestaurantSmallCardSkeleton />
              <RestaurantSmallCardSkeleton />
              <RestaurantSmallCardSkeleton />
            </View>
          </View>
        </View>

        {/* New Restaurants section */}
        <View style={screenStyles.sectionBlock}>
          <View style={screenStyles.sectionRow}>
            <Skeleton width={150} height={22} borderRadius={4} />
            <Skeleton width={60} height={14} borderRadius={4} />
          </View>
          <View style={screenStyles.horizontalListContent}>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <RestaurantSmallCardSkeleton />
              <RestaurantSmallCardSkeleton />
              <RestaurantSmallCardSkeleton />
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Home screen ─────────────────────────────────────────────────────────────

interface UserLocation {
  latitude: number;
  longitude: number;
}

// Stable empty fallback so memo deps don't churn while the feed loads.
const EMPTY_RESTAURANTS: Restaurant[] = [];

export default function HomeFeedScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { styles: screenStyles, colors } = useThemedStyles(makeScreenStyles);

  // Home feed via React Query (src/hooks/useHomeFeed.ts): cached between
  // visits (and offline via the persister), deduped, background-refetched on
  // foreground. A failed refresh keeps the last good data automatically —
  // the old hand-rolled keep-stale behavior, for free.
  const feedQuery = useHomeFeed();
  const restaurants = feedQuery.data?.restaurants ?? EMPTY_RESTAURANTS;
  const featuredRestaurants = feedQuery.data?.featured ?? EMPTY_RESTAURANTS;
  // Skeleton on first load AND on retry-after-error (no data to show yet).
  const isLoading =
    feedQuery.isPending || (feedQuery.isFetching && !feedQuery.data);
  const isRefreshing = feedQuery.isRefetching;
  // Only flip to the error screen when there's nothing to show.
  const loadError =
    feedQuery.isError && !feedQuery.data ? (feedQuery.error as Error) : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState(false);
  const [spotOfTheDay, setSpotOfTheDay] = useState<SpotOfTheDay | null>(null);
  const [filters, setFilters] = useState<HomeFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // SERVER-side search over the whole catalogue (debounced). Local matches
  // from the loaded feed show instantly; these fill in everything beyond it.
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const searchResults = useRestaurantSearch(debouncedQuery);

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
      // Location is decorative — Sentry-only, no UI surface needed; the
      // existing "Location access needed" tile handles user feedback.
      setLocationError(true);
    }
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Onboarding taste favorites — personalize the All Spots ordering. Loaded
  // once; empty (no personalization) on failure.
  const [favoriteCuisines, setFavoriteCuisines] = useState<Set<string>>(
    new Set(),
  );
  const [favoriteParishes, setFavoriteParishes] = useState<Set<Parish>>(
    new Set(),
  );
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
    return () => {
      active = false;
    };
  }, []);

  // Resolve Spot of the Day whenever the restaurant list changes (load/refresh).
  // Tolerant: any failure (incl. the manual-pin config) just hides the hero.
  useEffect(() => {
    if (restaurants.length === 0) {
      setSpotOfTheDay(null);
      return;
    }
    let active = true;
    resolveSpotOfTheDay(restaurants)
      .then((spot) => {
        if (active) setSpotOfTheDay(spot);
      })
      .catch(() => {
        if (active) setSpotOfTheDay(null);
      });
    return () => {
      active = false;
    };
  }, [restaurants]);

  const { refetch: refetchFeed } = feedQuery;
  const onRefresh = useCallback(() => {
    refetchFeed();
  }, [refetchFeed]);
  const handleRetry = onRefresh;

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

  // Distance (km) per restaurant for the "Nearest" sort. Empty without location.
  const distanceById = useMemo(() => {
    const map = new Map<string, number>();
    if (!userLocation) return map;
    for (const r of restaurants) {
      map.set(
        r.id,
        getDistanceKm(
          userLocation.latitude,
          userLocation.longitude,
          r.latitude,
          r.longitude,
        ),
      );
    }
    return map;
  }, [restaurants, userLocation]);

  // Category + search filter — the base the filter sheet counts against.
  const searchedRestaurants = useMemo(() => {
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
      // Merge in server matches beyond the loaded feed (deduped). They
      // already match the query server-side — incl. parish/city, which the
      // local filter doesn't check — so only the category filter reapplies.
      const server = searchResults.data;
      if (server && server.length > 0) {
        const have = new Set(list.map((r) => r.id));
        const cat = activeCategory.toLowerCase();
        const extras = server.filter(
          (r) =>
            !have.has(r.id) &&
            (activeCategory === "all" ||
              r.cuisines.some((c) => c.toLowerCase() === cat) ||
              r.categories.some((c) => c.toLowerCase() === cat)),
        );
        if (extras.length > 0) list = [...list, ...extras];
      }
    }
    return list;
  }, [restaurants, searchQuery, activeCategory, searchResults.data]);

  const activeFilterCount = countActiveFilters(filters);

  // Apply the filter-sheet filters (rating / price / sort / verified) on top.
  const filteredRestaurants = useMemo(
    () => applyHomeFilters(searchedRestaurants, filters, distanceById),
    [searchedRestaurants, filters, distanceById],
  );

  // New = strictly the most recently added, regardless of feed order.
  const newRestaurants = useMemo(
    () =>
      [...restaurants]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
    [restaurants],
  );

  // Hidden Gems — great rating, still few reviews. Best first (highest rating,
  // then fewest reviews = most under-the-radar).
  const hiddenGems = useMemo(
    () =>
      restaurants
        .filter(
          (r) =>
            r.reviewCount >= GEM_MIN_REVIEWS &&
            r.reviewCount <= GEM_MAX_REVIEWS &&
            r.averageRating >= GEM_MIN_RATING,
        )
        .sort(
          (a, b) =>
            b.averageRating - a.averageRating || a.reviewCount - b.reviewCount,
        )
        .slice(0, HIDDEN_GEMS_MAX),
    [restaurants],
  );

  // Default view = no search and "All" category. Only then do we cap the
  // All Spots feed to a preview + route to the dedicated /restaurants/all
  // page. When the user is searching or filtering by category we show every
  // match inline (no cap, no "see all"), so results are never hidden.
  const isDefaultView =
    !searchQuery && activeCategory === "all" && activeFilterCount === 0;

  // In the default view the All Spots preview uses the SAME personalized
  // ranking (taste + location + seeded shuffle) and the SAME shared seed as the
  // /restaurants/all "See all" page, so the preview and See-all match.
  const visibleSpots = useMemo(() => {
    if (!isDefaultView) return filteredRestaurants;
    const ranked = rankAllSpots(filteredRestaurants, {
      favoriteCuisines,
      favoriteParishes,
      userLocation,
      seed: ALL_SPOTS_SEED,
    });
    return ranked.slice(0, ALL_SPOTS_PREVIEW);
  }, [
    isDefaultView,
    filteredRestaurants,
    favoriteCuisines,
    favoriteParishes,
    userLocation,
  ]);
  const hasMoreSpots =
    isDefaultView && filteredRestaurants.length > ALL_SPOTS_PREVIEW;

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

  const handleSeeAllSpots = useCallback(
    () => router.push("/restaurants/all"),
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
        distance={
          filters.sort === "nearest" ? distanceById.get(item.id) : undefined
        }
      />
    ),
    [handlePress, filters.sort, distanceById],
  );

  const renderListHeader = useCallback(
    () => (
      <View>
        {/* Spot of the Day */}
        {isDefaultView && spotOfTheDay ? (
          <View style={screenStyles.spotWrap}>
            <SpotOfTheDayHero
              restaurant={spotOfTheDay.restaurant}
              thumbnailImageId={spotOfTheDay.thumbnailImageId}
              onPress={handlePress}
            />
          </View>
        ) : null}

        {/* Featured */}
        {isDefaultView && featuredRestaurants.length > 0 ? (
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
        {isDefaultView ? (
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

            {/* Location not yet acquired — show skeleton cards instead of a
                spinner, matching the post-load layout. */}
            {!userLocation && !locationError ? (
              <View style={screenStyles.horizontalListContent}>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <RestaurantSmallCardSkeleton />
                  <RestaurantSmallCardSkeleton />
                  <RestaurantSmallCardSkeleton />
                </View>
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
        {isDefaultView && newRestaurants.length > 0 ? (
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

        {/* Hidden Gems — highly rated, still under the radar */}
        {isDefaultView && hiddenGems.length > 0 ? (
          <View style={screenStyles.sectionBlock}>
            <View style={screenStyles.sectionRow}>
              <View style={screenStyles.sectionTitleRow}>
                <Text style={screenStyles.sectionTitle}>Hidden Gems</Text>
                <MaterialCommunityIcons
                  name="diamond-stone"
                  size={16}
                  color={colors.primary}
                />
              </View>
            </View>
            <FlatList
              horizontal
              data={hiddenGems}
              keyExtractor={(item) => `gem-${item.id}`}
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

        {/* All Spots header — in the default view the count slot becomes a
            "See all" link to /restaurants/all. When searching/filtering we
            show the match count instead, since everything is already on
            screen. */}
        <View style={screenStyles.allSpotsHeader}>
          <Text style={screenStyles.sectionTitle}>
            {searchQuery || activeFilterCount > 0
              ? "Results"
              : activeCategory !== "all"
                ? CATEGORIES.find((c) => c.id === activeCategory)?.label
                : "All Spots"}
          </Text>
          {isDefaultView ? (
            <SeeAllButton onPress={handleSeeAllSpots} />
          ) : (
            <Text style={screenStyles.countText}>
              {filteredRestaurants.length} places
            </Text>
          )}
        </View>
      </View>
    ),
    [
      searchQuery,
      activeCategory,
      spotOfTheDay,
      featuredRestaurants,
      nearbyRestaurants,
      newRestaurants,
      hiddenGems,
      filteredRestaurants.length,
      isDefaultView,
      activeFilterCount,
      userLocation,
      locationError,
      handlePress,
      handleSeeAllFeatured,
      handleSeeAllNew,
      handleSeeAllSpots,
      requestLocation,
      screenStyles,
      colors,
    ],
  );

  if (isLoading) {
    return <HomeSkeleton />;
  }

  // Empty AND failed → show the error screen instead of the popup. The
  // old Alert.alert was disruptive and required dismissal before the
  // user could even pull to refresh.
  if (loadError && restaurants.length === 0) {
    return (
      <SafeAreaView style={screenStyles.container} edges={["top"]}>
        <ErrorState
          variant="screen"
          icon="cloud-off-outline"
          title="Couldn't load Hidden Plate"
          body="Check your connection and try again."
          onRetry={handleRetry}
        />
      </SafeAreaView>
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

        <View style={screenStyles.searchRow}>
          <View style={screenStyles.searchBar}>
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={colors.textSecondary}
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

          <Pressable
            onPress={() => setFilterOpen(true)}
            style={[
              screenStyles.filterBtn,
              activeFilterCount > 0 && screenStyles.filterBtnActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              activeFilterCount > 0
                ? `Filters, ${activeFilterCount} active`
                : "Filters"
            }
          >
            <MaterialCommunityIcons
              name="tune-variant"
              size={22}
              color={
                activeFilterCount > 0 ? colors.primary : colors.textSecondary
              }
            />
            {activeFilterCount > 0 ? (
              <View style={screenStyles.filterBadge}>
                <Text style={screenStyles.filterBadgeText}>
                  {activeFilterCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <CategoryChips
          activeId={activeCategory}
          onSelect={setActiveCategory}
        />
      </Animated.View>

      <View style={screenStyles.headerDivider} />

      <FlatList
        data={visibleSpots}
        keyExtractor={(item) => item.id}
        renderItem={renderFeedItem}
        ListHeaderComponent={renderListHeader}
        contentContainerStyle={screenStyles.feedContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        style={screenStyles.feedList}
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
          hasMoreSpots ? (
            <Pressable
              style={screenStyles.viewAllBtn}
              onPress={handleSeeAllSpots}
              accessibilityRole="button"
              accessibilityLabel={`View all ${filteredRestaurants.length} places`}
            >
              <Text style={screenStyles.viewAllText}>
                View all {filteredRestaurants.length} places
              </Text>
              <MaterialCommunityIcons
                name="arrow-right"
                size={18}
                color={colors.primary}
              />
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

      <HomeFilterSheet
        visible={filterOpen}
        initial={filters}
        baseList={searchedRestaurants}
        hasLocation={!!userLocation}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeScreenStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Full page surface — matches Community, Saved, and Profile.
  container: { flex: 1, backgroundColor: colors.cardBackground },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
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

  // Search row — an elevated white search pill + a circular filter button.
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchBar: {
    flex: 1,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
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
  filterBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.sm,
  },
  filterBtnActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.cardBackground,
  },
  filterBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textInverse,
    lineHeight: 12,
  },

  // Feed list now sits on the white page surface.
  feedList: { backgroundColor: colors.cardBackground },
  feedContent: { paddingTop: spacing.sm, paddingBottom: 100 },

  // Spot of the Day hero wrapper — screen padding around the gradient banner.
  spotWrap: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },

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
    paddingTop: spacing.lg,
    marginBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
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

  // Section blocks no longer paint their own white background — the whole
  // page is white. Visual separation comes from a hairline divider at
  // the bottom of each section.
  sectionBlock: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
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

  // "View all" footer — replaces the old "Load more" button. Sends the
  // user to /restaurants/all rather than expanding the list in place.
  // Uses pageBackground fill so it stays visible on the now-white page.
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.screen,
    marginTop: spacing.lg,
    marginBottom: 100,
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  viewAllText: {
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
}

function makeFeaturedStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
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
    color: colors.textInverse,
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
}
