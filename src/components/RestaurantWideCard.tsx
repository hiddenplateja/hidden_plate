// src/components/RestaurantWideCard.tsx
// Reusable full-width restaurant card — used in the home "All Spots" feed
// and anywhere else a wide image+info stack fits (vertical lists).
//
// Design: large 200px image on top, info on bottom (white card background).
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

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
    FadeInDown,
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
}

function coverUrl(r: Restaurant): string | null {
  const id = r.coverImageId ?? r.imageIds[0] ?? null;
  return id ? getImagePreviewUrl(id) : null;
}

export const RestaurantWideCard = memo(function RestaurantWideCard({
  restaurant,
  onPress,
  animationDelay,
  marginHorizontal,
}: RestaurantWideCardProps) {
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
      style={[
        styles.card,
        { marginHorizontal: cardMarginHorizontal },
        animStyle,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`View ${restaurant.name}`}
    >
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
            size={36}
            color={colors.border}
          />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {restaurant.name}
        </Text>

        {hasReviews ? (
          <View style={styles.ratingRow}>
            <MaterialCommunityIcons name="star" size={14} color={STAR_COLOR} />
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

        {cuisineLine ? (
          <Text style={styles.subDetail} numberOfLines={1}>
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.sm,
  },
  image: {
    width: "100%",
    height: 200,
    backgroundColor: colors.pageBackground,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
  },
  info: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
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
});
