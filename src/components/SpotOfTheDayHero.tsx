// src/components/SpotOfTheDayHero.tsx
// "Spot of the Day" hero.
//
// Background: the restaurant's own cover image, full-bleed, under a warm dark
// scrim so the white text/pill stay legible. Falls back to the coral→orange
// gradient when the restaurant has no image.
//
// Side thumbnail: a random photo from the restaurant's reviews (passed in as
// thumbnailImageId); falls back to a default placeholder when there are none.
//
// Purely presentational: which restaurant + thumbnail are shown is resolved
// upstream by services/spotOfTheDay. Tapping anywhere opens the restaurant.

import { Image } from "expo-image";
import { ArrowRight, Sparkles, Star, UtensilsCrossed } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { getImagePreviewUrl } from "@/services/storage";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { Restaurant } from "@/types/restaurant";
import { getCuisineLine } from "@/utils/restaurantDisplay";

const CORAL_GRADIENT = ["#FF6F6B", "#FF9E4F"] as const; // no-image fallback
// Warm dark scrim over the cover photo: darker on the left (under the text),
// lighter on the right so the photo reads. Min 0.40 keeps white text legible.
const PHOTO_SCRIM = ["rgba(15,9,6,0.82)", "rgba(15,9,6,0.40)"] as const;
const PILL_BG = "#FFC93C"; // gold pill
const PILL_INK = "#2A1A0A"; // dark text on gold
const CTA_CORAL = "#FF6B4E"; // coral text on the white button

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  restaurant: Restaurant;
  /** A review photo id for the side thumbnail; null → default placeholder. */
  thumbnailImageId: string | null;
  onPress: (restaurantId: string) => void;
}

function coverUrl(r: Restaurant): string | null {
  const id = r.coverImageId ?? r.imageIds[0] ?? null;
  return id ? getImagePreviewUrl(id) : null;
}

export const SpotOfTheDayHero = memo(function SpotOfTheDayHero({
  restaurant,
  thumbnailImageId,
  onPress,
}: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const handlePress = useCallback(
    () => onPress(restaurant.id),
    [onPress, restaurant.id],
  );

  const bgUrl = coverUrl(restaurant);
  const thumbUrl = thumbnailImageId ? getImagePreviewUrl(thumbnailImageId) : null;
  const tagline =
    restaurant.description?.trim() || getCuisineLine(restaurant) || "";
  const hasRating = restaurant.reviewCount > 0;

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.98, { damping: 15, stiffness: 350 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 350 });
      }}
      style={[styles.shadow, animStyle]}
      accessibilityRole="button"
      accessibilityLabel={`Spot of the day: ${restaurant.name}`}
    >
      <View style={styles.card}>
        {/* Background — restaurant photo + scrim, or coral gradient fallback */}
        {bgUrl ? (
          <>
            <Image
              source={{ uri: bgUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
              cachePolicy="memory-disk"
            />
            <LinearGradient
              colors={PHOTO_SCRIM}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.4 }}
              style={StyleSheet.absoluteFill}
            />
          </>
        ) : (
          <LinearGradient
            colors={CORAL_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Foreground content */}
        <View style={styles.row}>
          <View style={styles.content}>
            <View style={styles.pill}>
              <Sparkles size={11} color={PILL_INK} strokeWidth={2} />
              <Text style={styles.pillText}>SPOT OF THE DAY</Text>
            </View>

            <Text style={styles.name} numberOfLines={2}>
              {restaurant.name}
            </Text>

            {tagline ? (
              <Text style={styles.tagline} numberOfLines={2}>
                {tagline}
              </Text>
            ) : null}

            <View style={styles.bottomRow}>
              <View style={styles.cta}>
                <Text style={styles.ctaText}>View spot</Text>
                <ArrowRight size={15} color={CTA_CORAL} strokeWidth={2.2} />
              </View>
              {hasRating ? (
                <View style={styles.ratingRow}>
                  <Star size={14} color="#FFD54A" fill="#FFD54A" />
                  <Text style={styles.ratingText}>
                    {restaurant.averageRating.toFixed(1)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Side thumbnail (random review photo) with a white frame */}
          <View style={styles.thumbFrame}>
            {thumbUrl ? (
              <Image
                source={{ uri: thumbUrl }}
                style={styles.thumbImage}
                contentFit="cover"
                transition={250}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.thumbImage, styles.thumbPlaceholder]}>
                <UtensilsCrossed
                  size={26}
                  color="rgba(255,255,255,0.9)"
                  strokeWidth={1.8}
                />
              </View>
            )}
          </View>
        </View>
      </View>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  shadow: {
    borderRadius: radius.xl,
    ...shadows.md,
  },
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: "#2A1A12", // shows under the photo while it loads
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  content: {
    flex: 1,
    gap: spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    backgroundColor: PILL_BG,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  pillText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: PILL_INK,
    letterSpacing: T.tracking.wider,
  },
  name: {
    fontFamily: fonts.black,
    fontSize: T.size.xl,
    color: "#FFFFFF",
  },
  tagline: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: "rgba(255,255,255,0.92)",
    lineHeight: T.leading.snug,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: CTA_CORAL,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: "#FFFFFF",
  },
  thumbFrame: {
    width: 92,
    height: 116,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
});
