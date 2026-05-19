// src/components/ReviewItem.tsx
// List item for a single review (shown on restaurant detail + all reviews).
//
// Shows: user avatar + display name (tappable to view their profile),
// star rating, time-ago, comment, photos, like button + count, and
// edit/delete menu when the review belongs to the current user.
//
// Author info is passed in via the `author` prop — the parent screen is
// responsible for batch-loading users for visible reviews (avoids N+1).

import { Image } from "expo-image";
import { memo } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { getImageViewUrl } from "@/services/storage";
import {
  colors,
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

interface ReviewItemProps {
  review: Review;
  author: User | null;
  isOwn: boolean;
  isLiked: boolean;
  likeBusy: boolean;
  onToggleLike: (reviewId: string, currentlyLiked: boolean) => void;
  onEdit?: (review: Review) => void;
  onDelete?: (review: Review) => void;
  onPhotoTap?: (imageIds: string[], startIndex: number) => void;
  onAuthorPress?: (userId: string) => void;
}

function ReviewItemImpl({
  review,
  author,
  isOwn,
  isLiked,
  likeBusy,
  onToggleLike,
  onEdit,
  onDelete,
  onPhotoTap,
  onAuthorPress,
}: ReviewItemProps) {
  const displayName = author?.displayName ?? "Hidden Plate user";
  const username = author?.username;

  const handleDeletePress = () => {
    Alert.alert("Delete review?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete?.(review),
      },
    ]);
  };

  return (
    <View style={styles.item}>
      <View style={styles.headerRow}>
        <Pressable
          style={styles.authorRow}
          onPress={() => {
            if (onAuthorPress) onAuthorPress(review.userId);
          }}
          disabled={!onAuthorPress}
          accessibilityRole={onAuthorPress ? "button" : undefined}
          accessibilityLabel={
            onAuthorPress ? `View ${displayName}'s profile` : undefined
          }
        >
          <Avatar
            fileId={author?.avatarUrl}
            displayName={displayName}
            userId={review.userId}
            size={36}
          />
          <View style={styles.headerInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
              {isOwn ? <Text style={styles.youBadge}>You</Text> : null}
            </View>
            <View style={styles.metaRow}>
              <StarRating value={review.rating} size={14} />
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.timeAgo}>
                {formatTimeAgo(review.createdAt)}
              </Text>
              {review.isEdited ? (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.editedText}>edited</Text>
                </>
              ) : null}
              {username ? (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.handle} numberOfLines={1}>
                    @{username}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </Pressable>
        {isOwn ? (
          <View style={styles.ownActions}>
            {onEdit ? (
              <Pressable
                onPress={() => onEdit(review)}
                hitSlop={8}
                style={styles.ownAction}
                accessibilityRole="button"
                accessibilityLabel="Edit review"
              >
                <Text style={styles.ownActionText}>Edit</Text>
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable
                onPress={handleDeletePress}
                hitSlop={8}
                style={styles.ownAction}
                accessibilityRole="button"
                accessibilityLabel="Delete review"
              >
                <Text style={[styles.ownActionText, styles.ownActionDanger]}>
                  Delete
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {review.comment ? (
        <Text style={styles.comment}>{review.comment}</Text>
      ) : null}

      {review.imageIds.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoRow}
        >
          {review.imageIds.map((fileId, i) => (
            <Pressable
              key={fileId}
              onPress={() => onPhotoTap?.(review.imageIds, i)}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${i + 1} of ${review.imageIds.length}`}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <Image
                source={{ uri: getImageViewUrl(fileId) }}
                style={styles.photoThumb}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.footerRow}>
        <Pressable
          onPress={() => onToggleLike(review.id, isLiked)}
          disabled={likeBusy || isOwn}
          accessibilityRole="button"
          accessibilityLabel={isLiked ? "Unlike review" : "Like review"}
          style={({ pressed }) => [
            styles.likeButton,
            pressed && styles.pressed,
            isOwn && styles.likeDisabled,
          ]}
          hitSlop={6}
        >
          <Text style={[styles.heart, isLiked && styles.heartLiked]}>
            {isLiked ? "♥" : "♡"}
          </Text>
          <Text style={styles.likeCount}>{review.likeCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const ReviewItem = memo(ReviewItemImpl);

// ---------- helpers ----------

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
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

// ---------- styles ----------

const styles = StyleSheet.create({
  item: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.cardBackground,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.xs,
  },
  authorRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  headerInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  youBadge: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    marginLeft: spacing.xs,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
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
  handle: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    flexShrink: 1,
  },
  ownActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginLeft: spacing.sm,
  },
  ownAction: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  ownActionText: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  ownActionDanger: {
    color: colors.error,
  },
  comment: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    lineHeight: 22,
    marginTop: spacing.xs,
    marginLeft: 36 + spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  photoRow: {
    paddingTop: spacing.sm,
    marginLeft: 36 + spacing.sm,
    gap: spacing.xs,
  },
  photoThumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    marginLeft: 36 + spacing.sm,
  },
  likeButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: -8,
  },
  likeDisabled: {
    opacity: 0.5,
  },
  heart: {
    fontSize: 18,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  heartLiked: {
    color: colors.primary,
  },
  likeCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
});
