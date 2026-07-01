// src/components/ReviewItem.tsx
// List item for a single review (shown on restaurant detail + all reviews).
//
// Shows: user avatar + display name (tappable to view their profile),
// star rating, time-ago, comment, photos, like button + count, and
// edit/delete menu when the review belongs to the current user.
//
// Author info is passed in via the `author` prop — the parent screen is
// responsible for batch-loading users for visible reviews (avoids N+1).

import { MaterialCommunityIcons } from "@expo/vector-icons";
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
import type { ReviewResponse } from "@/services/reviewResponses";
import { getImageViewUrl } from "@/services/storage";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
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
  /** Tap the row to open the full review (comments + owner reply). */
  onOpen?: (review: Review) => void;
  /** The restaurant owner's reply to this review, shown inline (read-only). */
  ownerReply?: ReviewResponse | null;
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
  onOpen,
  ownerReply,
}: ReviewItemProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const displayName = author?.displayName ?? "Hidden Plate user";
  const username = author?.username;
  // Replies = the owner's reply (if any) + user comments. The footer always
  // offers the reply affordance (opens the full review); it shows the count
  // once there's at least one, and just "Reply" while there are none.
  const replyCount = review.commentCount + (ownerReply ? 1 : 0);

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
    <Pressable
      onPress={onOpen ? () => onOpen(review) : undefined}
      disabled={!onOpen}
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={onOpen ? "Open review" : undefined}
      style={({ pressed }) => [
        styles.item,
        onOpen && pressed && styles.itemPressed,
      ]}
    >
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

      {ownerReply ? (
        <View style={styles.ownerReply}>
          <View style={styles.ownerReplyHead}>
            <MaterialCommunityIcons
              name="storefront"
              size={13}
              color={colors.primary}
            />
            <Text style={styles.ownerReplyLabel}>Owner reply</Text>
          </View>
          <Text style={styles.ownerReplyText} numberOfLines={4}>
            {ownerReply.text}
          </Text>
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <Pressable
          onPress={() => onToggleLike(review.id, isLiked)}
          disabled={likeBusy || isOwn}
          accessibilityRole="button"
          accessibilityLabel={isLiked ? "Unlike review" : "Like review"}
          style={({ pressed }) => [
            styles.likeButton,
            isLiked && styles.likeButtonActive,
            pressed && styles.pressed,
            isOwn && styles.likeDisabled,
          ]}
          hitSlop={6}
        >
          <MaterialCommunityIcons
            name={isLiked ? "heart" : "heart-outline"}
            size={18}
            color={isLiked ? colors.primary : colors.textSecondary}
          />
          <Text style={[styles.likeCount, isLiked && styles.likeCountActive]}>
            {review.likeCount}
          </Text>
        </Pressable>

        {onOpen ? (
          <Pressable
            onPress={() => onOpen(review)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={
              replyCount > 0
                ? `View ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
                : "Reply to review"
            }
            style={({ pressed }) => [
              styles.repliesButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="comment-outline"
              size={17}
              color={colors.textSecondary}
            />
            <Text style={styles.repliesText}>
              {replyCount > 0
                ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
                : "Reply"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
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

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  item: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.cardBackground,
  },
  itemPressed: { backgroundColor: colors.pageBackground },
  ownerReply: {
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  ownerReplyHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 3,
  },
  ownerReplyLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
  },
  ownerReplyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textPrimary,
    lineHeight: 19,
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
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginLeft: -10,
    borderRadius: radius.full,
  },
  likeButtonActive: {
    backgroundColor: colors.primaryLight,
  },
  likeDisabled: {
    opacity: 0.5,
  },
  likeCount: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  likeCountActive: {
    color: colors.primary,
  },
  repliesButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.full,
  },
  repliesText: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  });
}
