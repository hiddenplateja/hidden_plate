// src/components/SavedRestaurantRow.tsx
// Compact list row for the Saved tab.
//
// Layout: square thumb (left) + info (right) + chevron (far right).
// Smaller and denser than the home feed cards — optimized for retrieval
// rather than discovery.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getImagePreviewUrl } from "@/services/storage";
import {
    colors,
    fonts,
    radius,
    shadows,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { Parish, Restaurant } from "@/types/restaurant";

interface SavedRestaurantRowProps {
  restaurant: Restaurant | null;
  onPress: () => void;
  onLongPress?: () => void;
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

function SavedRestaurantRowImpl({
  restaurant,
  onPress,
  onLongPress,
}: SavedRestaurantRowProps) {
  // Restaurant was deleted from the platform — show a placeholder row
  if (!restaurant) {
    return (
      <View style={[styles.row, styles.rowUnavailable]}>
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={20}
            color={colors.textMuted}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.unavailableTitle}>Currently unavailable</Text>
          <Text style={styles.unavailableSub}>
            This restaurant is no longer listed.
          </Text>
        </View>
      </View>
    );
  }

  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const thumbUrl = coverId ? getImagePreviewUrl(coverId) : null;
  const cuisine = restaurant.cuisines[0] ?? null;
  const parishText = PARISH_LABELS[restaurant.parish] ?? restaurant.parish;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={restaurant.name}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.thumbWrapper}>
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={22}
              color={colors.border}
            />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {restaurant.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {[cuisine, parishText].filter(Boolean).join(" · ")}
        </Text>
        {restaurant.reviewCount > 0 ? (
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="star" size={12} color={colors.star} />
            <Text style={styles.metaText}>
              {restaurant.averageRating.toFixed(1)}
            </Text>
            <Text style={styles.metaCount}>({restaurant.reviewCount})</Text>
          </View>
        ) : (
          <Text style={styles.metaMuted}>No reviews yet</Text>
        )}
      </View>

      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={colors.textMuted}
      />
    </Pressable>
  );
}

export const SavedRestaurantRow = memo(SavedRestaurantRowImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screen,
    gap: spacing.md,
  },
  rowUnavailable: {
    opacity: 0.6,
  },
  pressed: {
    backgroundColor: colors.pageBackground,
  },
  thumbWrapper: {
    borderRadius: radius.md,
    overflow: "hidden",
    ...shadows.xs,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  metaText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textPrimary,
  },
  metaCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  metaMuted: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  unavailableTitle: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  unavailableSub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
});
