// src/components/RestaurantSmallCard.tsx
// Reusable small restaurant card — used in horizontal scrolls on home
// ("Near You", "New Restaurants") and anywhere else compact cards fit.
//
// Design: image on top, info on bottom (white card background).
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

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";

import { getImagePreviewUrl } from "@/services/storage";
import {
    colors,
    fonts,
    radius,
    shadows,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { Restaurant } from "@/types/restaurant";
import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

const STAR_COLOR =
  (colors as unknown as Record<string, string>).star ?? "#F4A523";

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
      style={[styles.card, { width }, animStyle]}
      accessibilityRole="button"
      accessibilityLabel={`View ${restaurant.name}`}
    >
      <View style={styles.imageWrap}>
        {url ? (
          <Image
            source={{ uri: url }}
            style={styles.image}
            contentFit="cover"
            transition={250}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={28}
              color={colors.border}
            />
          </View>
        )}

        {showDistance ? (
          <View style={styles.distanceBadge}>
            <MaterialCommunityIcons
              name="map-marker"
              size={10}
              color={colors.primary}
            />
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
            <MaterialCommunityIcons name="star" size={14} color={STAR_COLOR} />
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    ...shadows.sm,
  },
  imageWrap: {
    width: "100%",
    height: 120,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.pageBackground,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  distanceBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
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
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: 4,
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
