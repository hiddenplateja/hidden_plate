// src/components/RestaurantCard.tsx
// List item for the restaurants feed.
//
// DIAGNOSTIC VERSION — has console.log statements to debug image loading.
// Remove the marked sections once images are working.

import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getImagePreviewUrl } from "@/services/storage";
import { colors, radius, spacing, typography } from "@/theme/colors";
import type { Parish, Restaurant } from "@/types/restaurant";

interface RestaurantCardProps {
  restaurant: Restaurant;
  onPress: (restaurant: Restaurant) => void;
}

const PARISH_LABELS: Record<Parish, string> = {
  kingston: "Kingston",
  st_andrew: "St. Andrew",
  st_thomas: "St. Thomas",
  portland: "Portland",
  st_mary: "St. Mary",
  st_ann: "St. Ann",
  trelawny: "Trelawny",
  st_james: "St. James",
  hanover: "Hanover",
  westmoreland: "Westmoreland",
  st_elizabeth: "St. Elizabeth",
  manchester: "Manchester",
  clarendon: "Clarendon",
  st_catherine: "St. Catherine",
};

function formatRating(rating: number): string {
  return rating.toFixed(1);
}

function RestaurantCardImpl({ restaurant, onPress }: RestaurantCardProps) {
  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const imageUrl = coverId
    ? getImagePreviewUrl(coverId, { width: 800, height: 500, quality: 75 })
    : null;

  // === DIAGNOSTIC LOGGING — remove after debugging ===
  console.log("[RestaurantCard]", {
    name: restaurant.name,
    coverImageId: restaurant.coverImageId,
    imageIds: restaurant.imageIds,
    resolvedCoverId: coverId,
    generatedUrl: imageUrl,
  });
  // ===================================================

  const parishLabel = PARISH_LABELS[restaurant.parish] ?? restaurant.parish;

  return (
    <Pressable
      onPress={() => onPress(restaurant)}
      accessibilityRole="button"
      accessibilityLabel={`${restaurant.name}, ${parishLabel}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.imageWrapper}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            onError={(error) => {
              console.log("[RestaurantCard] image load error:", {
                name: restaurant.name,
                url: imageUrl,
                error: error,
              });
            }}
            onLoad={() => {
              console.log("[RestaurantCard] image loaded:", restaurant.name);
            }}
          />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Text style={styles.placeholderText}>No photo</Text>
          </View>
        )}

        {restaurant.priceRange ? (
          <View style={styles.priceBadge}>
            <Text style={styles.priceText}>{restaurant.priceRange}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {restaurant.name}
          </Text>
          {restaurant.isVerified ? (
            <Text style={styles.verifiedBadge}>✓</Text>
          ) : null}
        </View>

        <Text style={styles.parish}>{parishLabel}</Text>

        <View style={styles.metaRow}>
          {restaurant.reviewCount > 0 ? (
            <>
              <Text style={styles.star}>★</Text>
              <Text style={styles.rating}>
                {formatRating(restaurant.averageRating)}
              </Text>
              <Text style={styles.reviewCount}>({restaurant.reviewCount})</Text>
            </>
          ) : (
            <Text style={styles.noReviews}>No reviews yet</Text>
          )}

          {restaurant.cuisines.length > 0 ? (
            <>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.cuisine} numberOfLines={1}>
                {restaurant.cuisines.slice(0, 2).join(", ")}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const RestaurantCard = memo(
  RestaurantCardImpl,
  (prev, next) =>
    prev.restaurant.id === next.restaurant.id &&
    prev.restaurant.updatedAt === next.restaurant.updatedAt &&
    prev.onPress === next.onPress,
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  imageWrapper: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 10,
    backgroundColor: colors.surface,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  priceBadge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  priceText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: "600",
  },
  info: {
    padding: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  name: {
    ...typography.h3,
    color: colors.text,
    flexShrink: 1,
  },
  verifiedBadge: {
    ...typography.bodyMedium,
    color: colors.success,
    marginLeft: spacing.xs,
  },
  parish: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  star: {
    color: "#F59E0B",
    fontSize: 14,
    marginRight: 2,
  },
  rating: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  reviewCount: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  noReviews: {
    ...typography.caption,
    color: colors.textMuted,
  },
  dot: {
    ...typography.body,
    color: colors.textMuted,
    marginHorizontal: spacing.sm,
  },
  cuisine: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
    textTransform: "capitalize",
  },
});
