// src/components/UserRow.tsx
// Reusable user row used in followers/following lists and user search.
//
// Layout: avatar (48px) + name/handle/bio + Follow button (or "You" badge).
// Tap the row → calls onPress with the user.
// Tap the button → calls onToggleFollow (only when isMe=false).

import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { Avatar } from "@/components/Avatar";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { User } from "@/types/user";

interface UserRowProps {
  user: User;
  isMe: boolean;
  isFollowing: boolean;
  busy: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
}

export function UserRow({
  user,
  isMe,
  isFollowing,
  busy,
  onPress,
  onToggleFollow,
}: UserRowProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`View ${user.displayName}'s profile`}
    >
      <Avatar
        fileId={user.avatarUrl}
        displayName={user.displayName}
        userId={user.id}
        size={48}
      />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text style={styles.handle} numberOfLines={1}>
          @{user.username}
        </Text>
        {user.bio ? (
          <Text style={styles.bio} numberOfLines={1}>
            {user.bio}
          </Text>
        ) : null}
      </View>
      {!isMe ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onToggleFollow();
          }}
          disabled={busy}
          style={({ pressed }) => [
            isFollowing ? styles.followingBtn : styles.followBtn,
            pressed && styles.pressedBtn,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            isFollowing
              ? `Unfollow ${user.displayName}`
              : `Follow ${user.displayName}`
          }
        >
          {busy ? (
            <ActivityIndicator
              size="small"
              color={isFollowing ? colors.primary : colors.textInverse}
            />
          ) : (
            <Text
              style={
                isFollowing ? styles.followingBtnText : styles.followBtnText
              }
            >
              {isFollowing ? "Following" : "Follow"}
            </Text>
          )}
        </Pressable>
      ) : (
        <View style={styles.youBadge}>
          <Text style={styles.youBadgeText}>You</Text>
        </View>
      )}
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.cardBackground,
  },
  pressed: {
    backgroundColor: colors.pageBackground,
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
  handle: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  bio: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  followBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    minWidth: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  followBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textInverse,
  },
  followingBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.cardBackground,
    borderWidth: 1.5,
    borderColor: colors.primary,
    minWidth: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  followingBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
  },
  pressedBtn: {
    opacity: 0.7,
  },
  youBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
    minWidth: 90,
    alignItems: "center",
  },
  youBadgeText: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  });
}
