// src/components/LikedPostItem.tsx
// Community post card for the profile Likes tab — posts the user has liked,
// shown alongside liked reviews (UserReviewItem renders those).
//
// Mirrors UserReviewItem's bordered-card look, but a post has no restaurant
// or rating: the header row is the AUTHOR (avatar + name), then the text and
// any photos. Tapping the card opens the post detail screen.

import { Image } from "expo-image";
import { MessageSquareText } from "lucide-react-native";
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { getImageViewUrl } from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Post } from "@/types/post";
import type { User } from "@/types/user";

interface LikedPostItemProps {
  post: Post;
  /** Post author — null when the account was deleted. */
  author: User | null;
  onPress: (postId: string) => void;
  onPhotoTap?: (imageIds: string[], startIndex: number) => void;
}

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

function LikedPostItemImpl({
  post,
  author,
  onPress,
  onPhotoTap,
}: LikedPostItemProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const authorName = author?.displayName ?? "Deleted user";

  return (
    <Pressable
      onPress={() => onPress(post.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Post by ${authorName}`}
    >
      {/* Author header row */}
      <View style={styles.authorRow}>
        <Avatar
          fileId={author?.avatarUrl}
          displayName={authorName}
          userId={post.userId}
          size={36}
        />
        <View style={styles.authorInfo}>
          <Text style={styles.authorName} numberOfLines={1}>
            {authorName}
          </Text>
          <View style={styles.metaRow}>
            <MessageSquareText
              size={11}
              color={colors.textMuted}
              strokeWidth={2}
            />
            <Text style={styles.metaText}>
              Post · {formatTimeAgo(post.createdAt)}
            </Text>
          </View>
        </View>
      </View>

      {/* Text */}
      <Text style={styles.body} numberOfLines={6}>
        {post.text}
      </Text>

      {/* Photos */}
      {post.imageIds.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoRow}
        >
          {post.imageIds.map((fileId, i) => (
            <Pressable
              key={fileId}
              onPress={(e) => {
                // Stop the press from propagating to the card itself
                e.stopPropagation?.();
                onPhotoTap?.(post.imageIds, i);
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
    </Pressable>
  );
}

export const LikedPostItem = memo(LikedPostItemImpl);

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
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
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    authorInfo: {
      flex: 1,
      gap: 2,
    },
    authorName: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    metaText: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textSecondary,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    photoRow: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
      gap: spacing.xs,
    },
    photoThumb: {
      width: 80,
      height: 80,
      borderRadius: radius.md,
      backgroundColor: colors.pageBackground,
    },
  });
}
