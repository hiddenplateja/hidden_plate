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

import { ArrowLeft, Bell } from "lucide-react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    SectionList,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NotificationItem } from "@/components/NotificationItem";
import { useNotifications } from "@/hooks/useNotifications";
import { getUsersByIds } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { AppNotification } from "@/types/notification";
import type { User } from "@/types/user";

// Group notifications into Today / This week / Earlier buckets.
const SECTION_ORDER = ["Today", "This week", "Earlier"] as const;

function sectionFor(iso: string): (typeof SECTION_ORDER)[number] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const t = new Date(iso).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - 6 * 86400000) return "This week";
  return "Earlier";
}

// ── Aggregation ─────────────────────────────────────────────────────────────
// Collapse many same-kind notifications on the SAME target into one row
// ("Jose and 5 others liked your post"), but only once a group reaches
// GROUP_THRESHOLD members. Below that, rows stay individual.
const GROUP_THRESHOLD = 3;

/** A list row: either a lone notification or an aggregated group. */
type Row =
  | { kind: "single"; id: string; sortTs: number; notification: AppNotification }
  | {
      kind: "group";
      id: string;
      sortTs: number;
      /** Most-recent member — drives the avatar + deep-link target. */
      latest: AppNotification;
      members: AppNotification[];
      body: string;
    };

/**
 * The key notifications must share to be grouped. like/comment group per target
 * (a specific post or review); follows group together ("… followed you").
 * Everything else (admin broadcasts) returns null and never groups.
 */
function groupKeyFor(n: AppNotification): string | null {
  if (n.type === "like" || n.type === "comment") {
    const target = n.data.postId
      ? `post:${n.data.postId}`
      : n.data.reviewId
        ? `review:${n.data.reviewId}`
        : null;
    return target ? `${n.type}:${target}` : null;
  }
  if (n.type === "follow") return "follow";
  return null;
}

/** "Jose and 5 others liked your post" — name from the most recent actor. */
function composeGroupBody(latest: AppNotification, othersCount: number): string {
  const name = latest.data.actorName?.trim() || "Someone";
  const who = `${name} and ${othersCount} ${
    othersCount === 1 ? "other" : "others"
  }`;
  const isPost = !!latest.data.postId;
  switch (latest.type) {
    case "like":
      return `${who} liked your ${isPost ? "post" : "review"}`;
    case "comment":
      return `${who} commented on your ${isPost ? "post" : "review"}`;
    case "follow":
      return `${who} followed you`;
    default:
      return latest.body;
  }
}

function buildRows(items: AppNotification[]): Row[] {
  // `items` arrive newest-first, so the first member seen for a key is newest.
  const buckets = new Map<string, AppNotification[]>();
  const rows: Row[] = [];
  const ts = (n: AppNotification) => new Date(n.createdAt).getTime();

  for (const n of items) {
    const key = groupKeyFor(n);
    if (!key) {
      rows.push({ kind: "single", id: n.id, sortTs: ts(n), notification: n });
      continue;
    }
    const arr = buckets.get(key);
    if (arr) arr.push(n);
    else buckets.set(key, [n]);
  }

  for (const [key, members] of buckets) {
    if (members.length >= GROUP_THRESHOLD) {
      const latest = members[0];
      rows.push({
        kind: "group",
        id: `group:${key}`,
        sortTs: ts(latest),
        latest,
        members,
        body: composeGroupBody(latest, members.length - 1),
      });
    } else {
      for (const n of members) {
        rows.push({ kind: "single", id: n.id, sortTs: ts(n), notification: n });
      }
    }
  }

  rows.sort((a, b) => b.sortTs - a.sortTs);
  return rows;
}

function buildSections(rows: Row[]): { title: string; data: Row[] }[] {
  const buckets: Record<string, Row[]> = {};
  for (const r of rows) {
    const key = sectionFor(new Date(r.sortTs).toISOString());
    (buckets[key] ??= []).push(r);
  }
  return SECTION_ORDER.filter((k) => buckets[k]?.length).map((k) => ({
    title: k,
    data: buckets[k],
  }));
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
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
  const [actors, setActors] = useState<Map<string, User>>(new Map());

  // Hydrate actor avatars for the rows (best-effort; falls back to initials).
  useEffect(() => {
    const ids = Array.from(
      new Set(notifications.map((n) => n.actorId).filter(Boolean)),
    );
    if (ids.length === 0) return;
    let active = true;
    getUsersByIds(ids)
      .then((map) => {
        if (active) setActors(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [notifications]);

  const rows = useMemo(() => buildRows(notifications), [notifications]);
  const sections = useMemo(() => buildSections(rows), [rows]);

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

  // Deep-link for a notification based on its type + payload.
  const navigate = useCallback(
    (notification: AppNotification) => {
      switch (notification.type) {
        case "follow":
          if (notification.actorId) {
            router.push(`/profile/${notification.actorId}`);
          }
          break;
        case "like":
        case "comment":
          if (notification.data.postId) {
            router.push(`/post/${notification.data.postId}` as unknown as Href);
          } else if (notification.data.reviewId) {
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
    [router],
  );

  const handlePress = useCallback(
    async (notification: AppNotification) => {
      // Mark this one read first (optimistic; safe to call on already-read too)
      if (!notification.isRead) {
        markAsRead(notification.id);
      }
      navigate(notification);
    },
    [markAsRead, navigate],
  );

  // An aggregated row: mark every member read, then deep-link via the latest.
  const handleGroupPress = useCallback(
    (group: Extract<Row, { kind: "group" }>) => {
      for (const m of group.members) {
        if (!m.isRead) markAsRead(m.id);
      }
      navigate(group.latest);
    },
    [markAsRead, navigate],
  );

  // Deleting an aggregated row removes every member.
  const handleGroupDelete = useCallback(
    (group: Extract<Row, { kind: "group" }>) => {
      for (const m of group.members) removeNotification(m.id);
    },
    [removeNotification],
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
          <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) =>
          item.kind === "group" ? (
            <NotificationItem
              notification={item.latest}
              actor={actors.get(item.latest.actorId) ?? null}
              overrideBody={item.body}
              onPress={() => handleGroupPress(item)}
              onDelete={() => handleGroupDelete(item)}
            />
          ) : (
            <NotificationItem
              notification={item.notification}
              actor={actors.get(item.notification.actorId) ?? null}
              onPress={handlePress}
              onDelete={removeNotification}
            />
          )
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        stickySectionHeadersEnabled={false}
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
                <Bell size={30} color={colors.textPrimary} strokeWidth={1.8} />
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

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
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
    backgroundColor: colors.surface,
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
    color: colors.onPrimary,
  },
  rightSpacer: { width: 36 },

  sectionHeader: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.cardBackground,
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
    backgroundColor: colors.surface,
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
}
