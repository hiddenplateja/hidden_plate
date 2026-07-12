// src/components/RestaurantWideCard.tsx
// Reusable full-width restaurant card — used in the home "All Spots" feed
// and anywhere else a wide image+info stack fits (vertical lists).
//
// Design: borderless / "Uber Eats" style — no card surface, border, or
// shadow. A large 200px rounded image with the info stacked directly on the
// page background below it.
// Stacked rows: name → rating (or "New listing") → cuisine line → location.
// Cuisine line: "<first cuisine> • <up to 2 categories>" e.g. "Jamaican • Jerk • BBQ"
// Location: prefers city, falls back to parish.
//
// Optional features:
//   - `animationDelay` (ms) — staggers a FadeInDown entrance. Used in lists
//     to create a cascading reveal. Pass `index * 60` for typical staggering.
//   - `marginHorizontal` — controls horizontal inset (default: spacing.screen)
//
// Distinct from:
//   - RestaurantSmallCard (compact horizontal-scroll card)
//   - RestaurantImageCard (full-bleed image with text-on-overlay)
//
// Also exports `RestaurantWideCardSkeleton` — the loading placeholder with
// matching layout. The skeleton intentionally has no entrance animation
// since it's only visible briefly before being replaced.

import { MapPin, Star } from "lucide-react-native";
import { Image } from "expo-image";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { OpenStatusBadge } from "@/components/OpenStatusBadge";
import { RestaurantImagePlaceholder } from "@/components/RestaurantImagePlaceholder";
import { Skeleton } from "@/components/Skeleton";
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
import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface RestaurantWideCardProps {
  restaurant: Restaurant;
  onPress: (restaurantId: string) => void;
  /**
   * Optional entrance animation delay in milliseconds.
   * When provided, the card animates in with a FadeInDown spring.
   * Typical usage in lists: `animationDelay={index * 60}`.
   */
  animationDelay?: number;
  /** Override the card's horizontal margin (default: spacing.screen) */
  marginHorizontal?: number;
  /** When set, shows the distance (km) on the location line — for "Nearest". */
  distance?: number;
}

function coverUrl(r: Restaurant): string | null {
  const id = r.coverImageId ?? r.imageIds[0] ?? null;
  return id ? getImagePreviewUrl(id) : null;
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export const RestaurantWideCard = memo(function RestaurantWideCard({
  restaurant,
  onPress,
  animationDelay,
  marginHorizontal,
  distance,
}: RestaurantWideCardProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const STAR_COLOR = colors.star;
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(
    () => onPress(restaurant.id),
    [onPress, restaurant.id],
  );

  const url = coverUrl(restaurant);
  const cuisineLine = getCuisineLine(restaurant);
  const locationLine = getLocationLine(restaurant);
  const hasReviews = restaurant.reviewCount > 0;
  const distLabel =
    typeof distance === "number" && distance >= 0
      ? formatDistance(distance)
      : null;
  const cardMarginHorizontal = marginHorizontal ?? spacing.screen;

  const cardElement = (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 15, stiffness: 350 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 350 });
      }}
      style={[{ marginHorizontal: cardMarginHorizontal }, animStyle]}
      accessibilityRole="button"
      accessibilityLabel={`View ${restaurant.name}`}
    >
      <View style={styles.image}>
        {/* Monogram tile sits BEHIND the image so a lazy-loading or missing
            photo shows a per-restaurant initial — never a bare grey rectangle
            while you scroll. The (full-res) image fades in over it once decoded. */}
        <RestaurantImagePlaceholder name={restaurant.name} />
        {url ? (
          <Image
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            recyclingKey={restaurant.id}
          />
        ) : null}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {restaurant.name}
        </Text>

        {hasReviews ? (
          <View style={styles.ratingRow}>
            <Star size={13} color={STAR_COLOR} fill={STAR_COLOR} />
            <Text style={styles.ratingValue}>
              {restaurant.averageRating.toFixed(1)}
            </Text>
            <Text style={styles.ratingCount}>({restaurant.reviewCount})</Text>
          </View>
        ) : (
          <Text style={styles.noReviews} numberOfLines={1}>
            New listing, no reviews
          </Text>
        )}

        <OpenStatusBadge hours={restaurant.openingHours} />

        {cuisineLine ? (
          <Text style={styles.subDetail} numberOfLines={1}>
            {cuisineLine}
          </Text>
        ) : null}

        {locationLine || distLabel ? (
          <View style={styles.locationRow}>
            {locationLine ? (
              <Text style={styles.locationText} numberOfLines={1}>
                {locationLine}
              </Text>
            ) : null}
            {distLabel ? (
              <>
                {locationLine ? (
                  <Text style={styles.locationText}> · </Text>
                ) : null}
                <MapPin size={12} color={colors.primary} strokeWidth={2.2} />
                <Text style={styles.distanceText}>{distLabel}</Text>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </AnimatedPressable>
  );

  // Wrap in Animated.View for entrance animation when delay is provided
  if (typeof animationDelay === "number") {
    return (
      <Animated.View entering={FadeInDown.delay(animationDelay).springify()}>
        {cardElement}
      </Animated.View>
    );
  }

  return cardElement;
});

// ─── Skeleton sibling ───────────────────────────────────────────────────────
// Matches the real card's 200px image + paddings + 4 info rows. Renders
// no entrance animation by default since skeletons are short-lived.

interface RestaurantWideCardSkeletonProps {
  marginHorizontal?: number;
}

export const RestaurantWideCardSkeleton = memo(
  function RestaurantWideCardSkeleton({
    marginHorizontal,
  }: RestaurantWideCardSkeletonProps) {
    const { styles } = useThemedStyles(makeStyles);
    const m = marginHorizontal ?? spacing.screen;
    return (
      <View style={{ marginHorizontal: m }}>
        {/* Image */}
        <Skeleton width="100%" height={200} borderRadius={radius.md} />

        <View style={styles.info}>
          {/* Name */}
          <Skeleton width="75%" height={20} borderRadius={4} />
          {/* Rating row */}
          <Skeleton width="35%" height={13} borderRadius={4} />
          {/* Cuisine */}
          <Skeleton width="60%" height={13} borderRadius={4} />
          {/* Location */}
          <Skeleton width="45%" height={11} borderRadius={4} />
        </View>
      </View>
    );
  },
);

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Borderless tile: the rounded image is the only "contained" element —
  // no wrapper background, border, or shadow.
  image: {
    width: "100%",
    height: 200,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.pageBackground,
  },
  info: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: 4,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.snug,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  ratingCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  noReviews: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  subDetail: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  locationText: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  distanceText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
    marginLeft: 2,
  },
  });
}
