// src/components/NotificationItem.tsx
// One row in the notifications list.
//
// Per-type icon + color, title + body + relative time. Unread state is
// shown via:
//   - left-edge dot
//   - subtle tinted background
//
// Swipe-right-to-left reveals a Delete action.
//
// Visual style matches the rest of Hidden Plate: white cards on a white
// page, hairline separators, no big shadows.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { AppNotification, NotificationType } from "@/types/notification";

interface NotificationItemProps {
  notification: AppNotification;
  onPress: (notification: AppNotification) => void;
  onDelete: (id: string) => void;
}

interface TypeStyle {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  bg: string;
}

// Per-type icon + tint. The bg color is used for the icon tile only —
// the row itself stays white (or near-white when unread).
const TYPE_STYLES: Record<NotificationType, TypeStyle> = {
  follow: {
    icon: "account-plus",
    color: colors.primary,
    bg: colors.primaryLight,
  },
  like: {
    icon: "heart",
    color: "#EF4444",
    bg: "#FEE2E2",
  },
  comment: {
    icon: "comment-text",
    color: "#3B82F6",
    bg: "#DBEAFE",
  },
  new_restaurant: {
    icon: "silverware-fork-knife",
    color: "#10B981",
    bg: "#D1FAE5",
  },
};

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
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
  onPress,
  onDelete,
}: NotificationItemProps) {
  const typeStyle = TYPE_STYLES[notification.type] ?? TYPE_STYLES.follow;

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    // Scale the trash icon based on swipe distance — a small touch of
    // polish that makes the swipe feel responsive.
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
        {/* Left unread dot */}
        {!notification.isRead ? <View style={styles.unreadDot} /> : null}

        {/* Icon tile */}
        <View style={[styles.iconWrap, { backgroundColor: typeStyle.bg }]}>
          <MaterialCommunityIcons
            name={typeStyle.icon}
            size={20}
            color={typeStyle.color}
          />
        </View>

        {/* Body */}
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.message} numberOfLines={2}>
            {notification.body}
          </Text>
          <Text style={styles.time}>{timeAgo(notification.createdAt)}</Text>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    gap: spacing.md,
  },
  // Subtle tint when unread — easier on the eyes than a heavy background
  rowUnread: {
    backgroundColor: colors.primaryLight,
  },
  unreadDot: {
    position: "absolute",
    left: 6,
    top: "50%",
    marginTop: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  time: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  deleteAction: {
    backgroundColor: "#EF4444",
    width: 80,
    justifyContent: "center",
    alignItems: "center",
  },
});
