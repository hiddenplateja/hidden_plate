// src/components/NotificationBell.tsx
// Bell icon with unread count badge.
//
// Styled to match the home screen's notifBtn — circular outlined button
// matching the search icon's appearance. Badge appears in the top-right
// when unreadCount > 0.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useNotifications } from "@/hooks/useNotifications";
import { fonts, radius, size } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface NotificationBellProps {
  onPress: () => void;
}

export function NotificationBell({ onPress }: NotificationBellProps) {
  const { unreadCount } = useNotifications();
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      style={styles.btn}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : "Notifications"
      }
    >
      <MaterialCommunityIcons
        name="bell-outline"
        size={22}
        color={colors.textPrimary}
      />
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  btn: {
    width: size.notifBtn,
    height: size.notifBtn,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  // Floating count badge — positioned to sit just outside the top-right
  // of the bell button. White ring around it so it stands out from the
  // page background.
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.cardBackground,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textInverse,
    lineHeight: 12,
  },
  });
}
