// src/components/RestaurantImageCard.tsx
// Reusable image-first restaurant card.
//
// Design: full-bleed image with dark gradient overlay, all info layered
// over the image. Compact (200px tall), used in vertical lists like the
// "See all" screens (/restaurants/featured, /restaurants/new).
//
// Stacked info: name → rating (or "New listing") → cuisine line → location.
// Cuisine line: "<first cuisine> • <up to 2 categories>" (e.g. "Jamaican • Jerk • BBQ")
// Location: prefers city, falls back to parish.
//
// Also exports `RestaurantImageCardSkeleton` — a placeholder shape that
// matches the card's 200px height + rounded corners. Just one large
// skeleton block, since the real card's info is overlaid on the image
// (no separate info section to mimic).

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

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

interface RestaurantImageCardProps {
  restaurant: Restaurant;
  onPress: (restaurantId: string) => void;
  /** Override the default card height (default: 200) */
  height?: number;
}

function coverUrl(r: Restaurant): string | null {
  const id = r.coverImageId ?? r.imageIds[0] ?? null;
  return id ? getImagePreviewUrl(id) : null;
}

export const RestaurantImageCard = memo(function RestaurantImageCard({
  restaurant,
  onPress,
  height = 200,
}: RestaurantImageCardProps) {
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

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 15, stiffness: 350 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 350 });
      }}
      style={[styles.card, { height }, animStyle]}
      accessibilityRole="button"
      accessibilityLabel={`View ${restaurant.name}`}
    >
      {/* Monogram tile sits BEHIND the image so a lazy-loading or missing photo
          shows a per-restaurant initial — never a bare grey rectangle while you
          scroll. The (full-res) image fades in over it once decoded. */}
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

      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]}
        style={styles.gradient}
      />

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
          <Text style={styles.noReviews}>New listing, no reviews</Text>
        )}

        {cuisineLine ? (
          <Text style={styles.cuisineLine} numberOfLines={1}>
            {cuisineLine}
          </Text>
        ) : null}

        {locationLine ? (
          <Text style={styles.locationLine} numberOfLines={1}>
            {locationLine}
          </Text>
        ) : null}
      </View>
    </AnimatedPressable>
  );
});

// ─── Skeleton sibling ───────────────────────────────────────────────────────
// Single full-card-sized block. Matches the real card's height + radius
// so the swap is seamless.

interface RestaurantImageCardSkeletonProps {
  height?: number;
}

export const RestaurantImageCardSkeleton = memo(
  function RestaurantImageCardSkeleton({
    height = 200,
  }: RestaurantImageCardSkeletonProps) {
    return <Skeleton width="100%" height={height} borderRadius={radius.xl} />;
  },
);

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.pageBackground,
    ...shadows.md,
  },
  gradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "70%",
  },
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: 2,
  },
  name: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textInverse,
    letterSpacing: T.tracking.tight,
    marginBottom: 4,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textInverse,
  },
  ratingCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: "rgba(255,255,255,0.82)",
  },
  noReviews: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: "rgba(255,255,255,0.82)",
    fontStyle: "italic",
  },
  cuisineLine: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: "rgba(255,255,255,0.92)",
    textTransform: "capitalize",
  },
  locationLine: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: "rgba(255,255,255,0.72)",
  },
  });
}
