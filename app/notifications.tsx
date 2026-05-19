// app/notifications.tsx
// Full-screen notifications list.
//
// Layout:
//   Header: back arrow · "Notifications" title · unread badge · "Mark all read"
//   List:   FlatList of NotificationItem rows
//   Empty:  centered illustration when list is empty
//
// Tap behavior:
//   - Marks the notification as read (if unread)
//   - Deep-links based on the notification type
//
// Mark-all-read happens on screen open if there are unread items —
// matches the spec: "Tapping the notifications screen marks them all read."

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NotificationItem } from "@/components/NotificationItem";
import { useNotifications } from "@/hooks/useNotifications";
import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { AppNotification } from "@/types/notification";

export default function NotificationsScreen() {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    refresh,
    fetchMore,
    markAsRead,
    markAllAsRead,
    removeNotification,
  } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  // Mark all as read when the screen first comes into focus.
  // Subsequent focus events (back-nav from review/profile) won't trigger
  // another mark-all because at that point everything's already read.
  useFocusEffect(
    useCallback(() => {
      if (unreadCount > 0) {
        markAllAsRead();
      }
      // intentionally omitting unreadCount from deps — we only want this
      // to run on focus, not whenever the count changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [markAllAsRead]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handlePress = useCallback(
    async (notification: AppNotification) => {
      // Mark this one read first (optimistic; safe to call on already-read too)
      if (!notification.isRead) {
        markAsRead(notification.id);
      }

      // Deep-link based on type
      switch (notification.type) {
        case "follow":
          if (notification.actorId) {
            router.push(`/profile/${notification.actorId}`);
          }
          break;
        case "like":
        case "comment":
          if (notification.data.reviewId) {
            router.push(`/review/${notification.data.reviewId}`);
          }
          break;
        case "new_restaurant":
          if (notification.data.restaurantId) {
            router.push(`/restaurant/${notification.data.restaurantId}`);
          }
          break;
      }
    },
    [markAsRead, router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>

        <View style={styles.titleWrap}>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>

        {/* Right side reserves space symmetrical to the back button so the
            title stays centered. Currently empty — mark-all-read happens
            automatically on focus. */}
        <View style={styles.rightSpacer} />
      </View>

      {/* List */}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationItem
            notification={item}
            onPress={handlePress}
            onDelete={removeNotification}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={
          notifications.length === 0 ? styles.emptyContent : undefined
        }
        showsVerticalScrollIndicator={false}
        onEndReached={hasMore ? fetchMore : undefined}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListFooterComponent={
          hasMore && isLoading ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="bell-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptyBody}>
                When someone follows you, likes your review, or comments,
                you&apos;ll see it here.
              </Text>
            </View>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cardBackground },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  unreadBadge: {
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.textInverse,
  },
  rightSpacer: { width: 36 },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: 80, // align with body text, not icon tile
  },
  footerLoader: { paddingVertical: spacing.lg, alignItems: "center" },

  emptyContent: {
    flex: 1,
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.huge,
  },
});
