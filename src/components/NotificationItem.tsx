// src/components/NotificationItem.tsx
// One row in the notifications list.
//
// Social-style row: the actor's avatar (real photo, or a deterministic
// initials circle) with a small per-type badge (follow / like / comment),
// the message, and the relative time + unread dot on the right.
// Admin broadcasts (new_restaurant, no actor) show a type-icon tile instead.
//
// Swipe-right-to-left reveals a Delete action.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { Avatar } from "@/components/Avatar";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { AppNotification, NotificationType } from "@/types/notification";
import type { User } from "@/types/user";

interface NotificationItemProps {
  notification: AppNotification;
  /** Hydrated actor (for the avatar). null → initials / type tile fallback. */
  actor: User | null;
  onPress: (notification: AppNotification) => void;
  onDelete: (id: string) => void;
}

// Per-type badge icon + color.
const TYPE_BADGE: Record<
  NotificationType,
  { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }
> = {
  follow: { icon: "account-plus", color: "#E94B3C" },
  like: { icon: "heart", color: "#EF4444" },
  comment: { icon: "comment-text", color: "#3B82F6" },
  new_restaurant: { icon: "silverware-fork-knife", color: "#10B981" },
};

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString("en-JM", {
    day: "numeric",
    month: "short",
  });
}

export function NotificationItem({
  notification,
  actor,
  onPress,
  onDelete,
}: NotificationItemProps) {
  const badge = TYPE_BADGE[notification.type] ?? TYPE_BADGE.follow;
  const hasActor = !!notification.actorId;
  const name =
    actor?.displayName ?? notification.data.actorName ?? "Hidden Plate";
  const { styles, colors } = useThemedStyles(makeStyles);

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.5],
      extrapolate: "clamp",
    });
    return (
      <Pressable
        style={styles.deleteAction}
        onPress={() => onDelete(notification.id)}
        accessibilityRole="button"
        accessibilityLabel="Delete notification"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <MaterialCommunityIcons
            name="trash-can-outline"
            size={22}
            color={colors.textInverse}
          />
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <Pressable
        onPress={() => onPress(notification)}
        style={[styles.row, !notification.isRead && styles.rowUnread]}
        accessibilityRole="button"
      >
        {/* Avatar (with type badge) or a type tile for admin broadcasts */}
        <View style={styles.leading}>
          {hasActor ? (
            <>
              <Avatar
                fileId={actor?.avatarUrl}
                displayName={name}
                userId={notification.actorId}
                size={48}
              />
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <MaterialCommunityIcons
                  name={badge.icon}
                  size={11}
                  color="#FFFFFF"
                />
              </View>
            </>
          ) : (
            <View
              style={[styles.typeTile, { backgroundColor: `${badge.color}22` }]}
            >
              <MaterialCommunityIcons
                name={badge.icon}
                size={22}
                color={badge.color}
              />
            </View>
          )}
        </View>

        {/* Message */}
        <View style={styles.body}>
          <Text style={styles.message} numberOfLines={2}>
            {notification.body}
          </Text>
        </View>

        {/* Time + unread dot */}
        <View style={styles.trailing}>
          <Text style={styles.time}>{timeAgo(notification.createdAt)}</Text>
          {!notification.isRead ? <View style={styles.unreadDot} /> : null}
        </View>
      </Pressable>
    </Swipeable>
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
    backgroundColor: colors.cardBackground,
    gap: spacing.md,
  },
  rowUnread: { backgroundColor: colors.primaryLight },
  leading: { width: 48, height: 48 },
  typeTile: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.cardBackground,
  },
  body: { flex: 1 },
  message: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  trailing: {
    alignSelf: "flex-start",
    alignItems: "flex-end",
    gap: 8,
    paddingTop: 2,
  },
  time: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  deleteAction: {
    backgroundColor: "#EF4444",
    width: 80,
    justifyContent: "center",
    alignItems: "center",
  },
  });
}
