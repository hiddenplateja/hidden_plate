// src/components/UserReviewItem.tsx
// Review item shown on a profile screen.
//
// Inverted from ReviewItem:
//   - ReviewItem (on restaurant detail): shows WHO wrote it, hides the restaurant
//   - UserReviewItem (on profile): shows WHAT was reviewed, hides the user
//
// Both share the same Review data — just different rendering for different contexts.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { StarRating } from "@/components/StarRating";
import { getImagePreviewUrl, getImageViewUrl } from "@/services/storage";
import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { Parish, Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";

interface UserReviewItemProps {
  review: Review;
  restaurant: Restaurant | null;
  onPress: (restaurantId: string) => void;
  onPhotoTap?: (imageIds: string[], startIndex: number) => void;
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

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

function UserReviewItemImpl({
  review,
  restaurant,
  onPress,
  onPhotoTap,
}: UserReviewItemProps) {
  // Restaurant was deleted from platform — render a muted "unavailable" row
  if (!restaurant) {
    return (
      <View style={[styles.card, styles.unavailable]}>
        <Text style={styles.unavailableTitle}>Restaurant no longer listed</Text>
        <Text style={styles.unavailableBody}>
          {review.comment ??
            "Your review for a restaurant that's been removed."}
        </Text>
      </View>
    );
  }

  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const thumbUrl = coverId ? getImagePreviewUrl(coverId) : null;
  const parishText = PARISH_LABELS[restaurant.parish] ?? restaurant.parish;

  return (
    <Pressable
      onPress={() => onPress(restaurant.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Review of ${restaurant.name}`}
    >
      {/* Restaurant header row */}
      <View style={styles.restaurantRow}>
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl }}
            style={styles.restaurantThumb}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.restaurantThumb, styles.thumbPlaceholder]}>
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={20}
              color={colors.border}
            />
          </View>
        )}
        <View style={styles.restaurantInfo}>
          <Text style={styles.restaurantName} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <Text style={styles.restaurantParish}>{parishText}</Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={18}
          color={colors.textMuted}
        />
      </View>

      {/* Review meta */}
      <View style={styles.metaRow}>
        <StarRating value={review.rating} size={14} />
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.timeAgo}>{formatTimeAgo(review.createdAt)}</Text>
        {review.isEdited ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.editedText}>edited</Text>
          </>
        ) : null}
      </View>

      {/* Comment */}
      {review.comment ? (
        <Text style={styles.comment} numberOfLines={6}>
          {review.comment}
        </Text>
      ) : null}

      {/* Photos */}
      {review.imageIds.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoRow}
        >
          {review.imageIds.map((fileId, i) => (
            <Pressable
              key={fileId}
              onPress={(e) => {
                // Stop the press from propagating to the card itself
                e.stopPropagation?.();
                onPhotoTap?.(review.imageIds, i);
              }}
            >
              <Image
                source={{ uri: getImageViewUrl(fileId) }}
                style={styles.photoThumb}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.likes}>
          <MaterialCommunityIcons
            name="heart-outline"
            size={14}
            color={colors.textMuted}
          />
          <Text style={styles.likeCount}>
            {review.likeCount} {review.likeCount === 1 ? "like" : "likes"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export const UserReviewItem = memo(UserReviewItemImpl);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    marginHorizontal: spacing.screen,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  pressed: {
    opacity: 0.95,
    backgroundColor: colors.pageBackground,
  },
  unavailable: {
    opacity: 0.6,
  },
  unavailableTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  unavailableBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  restaurantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  restaurantThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  restaurantInfo: {
    flex: 1,
    gap: 2,
  },
  restaurantName: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  restaurantParish: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  metaDot: {
    color: colors.textMuted,
    marginHorizontal: spacing.xs,
  },
  timeAgo: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  editedText: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  comment: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  photoRow: {
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  likes: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  likeCount: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
