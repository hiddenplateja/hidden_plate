// src/components/RestaurantSmallCard.tsx
// Reusable small restaurant card — used in horizontal scrolls on home
// ("Near You", "New Restaurants") and anywhere else compact cards fit.
//
// Design: borderless / "Uber Eats" style — no card surface, border, or
// shadow. Just a rounded image with the info stacked directly on the page
// background below it (name → rating → cuisine → location).
// Stacked rows: name → rating (or "New listing") → cuisine line → location.
// Cuisine line format: "<first cuisine> • <up to 2 categories>"
// e.g. "Jamaican • Jerk • BBQ"
// Location prefers city, falls back to parish.
//
// Optional features:
//   - `distance` prop adds a "1.2km away" badge top-left of the image
//   - `hideDistance` to suppress the badge even when distance is provided
//
// Distinct from RestaurantImageCard (full-bleed image with overlay) and
// RestaurantCard (older Saved-tab style).
//
// Also exports `RestaurantSmallCardSkeleton` — the loading placeholder
// with identical layout dimensions. Use in horizontal scrolls while
// fetching to avoid layout shift when real cards mount.

import { Image } from "expo-image";
import { MapPin, Star } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
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
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface RestaurantSmallCardProps {
  restaurant: Restaurant;
  onPress: (restaurantId: string) => void;
  /** Optional: shows a "X.Xkm away" badge in the top-left corner of the image */
  distance?: number;
  /** Force-hide the distance badge even when `distance` is set */
  hideDistance?: boolean;
  /** Override the default card width (default: 180) */
  width?: number;
}

function coverUrl(r: Restaurant): string | null {
  const id = r.coverImageId ?? r.imageIds[0] ?? null;
  return id ? getImagePreviewUrl(id) : null;
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m away` : `${km.toFixed(1)}km away`;
}

export const RestaurantSmallCard = memo(function RestaurantSmallCard({
  restaurant,
  onPress,
  distance,
  hideDistance,
  width = 180,
}: RestaurantSmallCardProps) {
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
  const showDistance =
    !hideDistance && typeof distance === "number" && distance > 0;

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 15, stiffness: 350 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 350 });
      }}
      style={[{ width }, animStyle]}
      accessibilityRole="button"
      accessibilityLabel={`View ${restaurant.name}`}
    >
      <View style={styles.imageWrap}>
        {/* Monogram tile behind the image: a lazy-loading or missing photo
            shows a per-restaurant initial, never a bare grey rectangle. */}
        <RestaurantImagePlaceholder name={restaurant.name} fontSize={44} />
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

        {showDistance ? (
          <View style={styles.distanceBadge}>
            <MapPin size={10} color={colors.primary} strokeWidth={2.4} />
            <Text style={styles.distanceText}>{formatDistance(distance)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>
          {restaurant.name}
        </Text>

        {hasReviews ? (
          <View style={styles.ratingRow}>
            <Star size={13} color={STAR_COLOR} fill={STAR_COLOR} />
            <Text style={styles.ratingValue}>
              {restaurant.averageRating.toFixed(1)}{" "}
              <Text style={styles.ratingCount}>({restaurant.reviewCount})</Text>
            </Text>
          </View>
        ) : (
          <Text style={styles.noReviews} numberOfLines={1}>
            New listing, no reviews
          </Text>
        )}

        <OpenStatusBadge hours={restaurant.openingHours} variant="compact" />

        {cuisineLine ? (
          <Text style={styles.cuisineText} numberOfLines={1}>
            {cuisineLine}
          </Text>
        ) : null}

        {locationLine ? (
          <Text style={styles.locationText} numberOfLines={1}>
            {locationLine}
          </Text>
        ) : null}
      </View>
    </AnimatedPressable>
  );
});

// ─── Skeleton sibling ───────────────────────────────────────────────────────
// Mirrors RestaurantSmallCard's layout exactly so swapping it for real
// content causes zero layout shift. Image area: 136px tall. Content:
// 4 stacked text rows (name, rating, cuisine, location).

interface RestaurantSmallCardSkeletonProps {
  /** Match the real card width — defaults to 180 like RestaurantSmallCard */
  width?: number;
}

export const RestaurantSmallCardSkeleton = memo(
  function RestaurantSmallCardSkeleton({
    width = 180,
  }: RestaurantSmallCardSkeletonProps) {
    const { styles } = useThemedStyles(makeStyles);
    return (
      <View style={{ width }}>
        {/* Image area */}
        <Skeleton width="100%" height={136} borderRadius={radius.md} />

        {/* Content rows */}
        <View style={styles.content}>
          {/* Name */}
          <Skeleton width="80%" height={15} borderRadius={4} />
          {/* Rating */}
          <Skeleton width="40%" height={12} borderRadius={4} />
          {/* Cuisine line */}
          <Skeleton width="70%" height={12} borderRadius={4} />
          {/* Location */}
          <Skeleton width="55%" height={10} borderRadius={4} />
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
  imageWrap: {
    width: "100%",
    height: 136,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.pageBackground,
  },
  distanceBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    gap: 3,
    ...shadows.xs,
  },
  distanceText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textPrimary,
  },
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: 3,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
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
    color: colors.textMuted,
  },
  noReviews: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  cuisineText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  locationText: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  });
}
