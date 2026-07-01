// app/blocked-users.tsx
// "Blocked Users" management screen. Lists the users YOU have blocked
// (not people who blocked you) so you can unblock them. Reached from
// Settings → Privacy → Blocked users.
//
// Mutual blocking means unblocking here lets that user see your content
// again (and you theirs), so we confirm before unblocking.
//
// Follows the same custom-header pattern as app/settings.tsx (the app hides
// the native stack header).

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { listBlockedUsers, unblockUser } from "@/services/blocks";
import { getImagePreviewUrl } from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { User } from "@/types/user";

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: User[] };

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setState({ status: "loading" });
    try {
      const users = await listBlockedUsers();
      setState({ status: "ready", users });
    } catch (err) {
      // listBlockedUsers already reports to Sentry; just surface a message.
      setState({
        status: "error",
        message:
          err instanceof Error
            ? err.message
            : "Check your connection and try again.",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const performUnblock = useCallback(async (target: User) => {
    setUnblockingIds((prev) => new Set(prev).add(target.id));
    // Optimistic — drop from the list immediately.
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        status: "ready",
        users: prev.users.filter((u) => u.id !== target.id),
      };
    });
    try {
      await unblockUser(target.id);
    } catch (err) {
      // Revert — put them back at the top.
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        if (prev.users.some((u) => u.id === target.id)) return prev;
        return { status: "ready", users: [target, ...prev.users] };
      });
      Alert.alert(
        "Couldn't unblock",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setUnblockingIds((prev) => {
        const s = new Set(prev);
        s.delete(target.id);
        return s;
      });
    }
  }, []);

  const handleUnblockPress = useCallback(
    (target: User) => {
      Alert.alert(
        "Unblock user",
        `Unblock @${target.username}? They'll be able to see your content again, and you'll see theirs.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unblock",
            style: "destructive",
            onPress: () => performUnblock(target),
          },
        ],
      );
    },
    [performUnblock],
  );

  const renderItem = useCallback(
    ({ item }: { item: User }) => {
      const avatar = item.avatarUrl ? getImagePreviewUrl(item.avatarUrl) : null;
      const busy = unblockingIds.has(item.id);
      return (
        <View style={styles.row}>
          {avatar ? (
            <Image
              source={{ uri: avatar }}
              style={styles.avatar}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <MaterialCommunityIcons
                name="account"
                size={22}
                color={colors.textMuted}
              />
            </View>
          )}

          <View style={styles.identity}>
            <Text style={styles.displayName} numberOfLines={1}>
              {item.displayName}
            </Text>
            <Text style={styles.username} numberOfLines={1}>
              @{item.username}
            </Text>
          </View>

          <Pressable
            onPress={() => handleUnblockPress(item)}
            disabled={busy}
            style={[styles.unblockBtn, busy && styles.unblockBtnBusy]}
            accessibilityRole="button"
            accessibilityLabel={`Unblock ${item.username}`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.unblockText}>Unblock</Text>
            )}
          </Pressable>
        </View>
      );
    },
    [unblockingIds, handleUnblockPress],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={{ width: 36 }} />
      </View>

      {state.status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : state.status === "error" ? (
        <ErrorState
          variant="screen"
          icon="cloud-off-outline"
          title="Couldn't load blocked users"
          body={state.message}
          onRetry={() => load()}
        />
      ) : (
        <FlatList
          data={state.users}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          contentContainerStyle={
            state.users.length === 0 ? styles.emptyContent : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="account-cancel-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>No blocked users</Text>
              <Text style={styles.emptyBody}>
                When you block someone they&apos;ll show up here. Neither of you
                will see the other&apos;s reviews or comments.
              </Text>
            </View>
          }
        />
      )}
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  listContent: {
    paddingVertical: spacing.sm,
    paddingBottom: 100,
  },
  emptyContent: {
    flexGrow: 1,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  identity: { flex: 1 },
  displayName: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  username: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    marginTop: 1,
  },
  unblockBtn: {
    minWidth: 84,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  unblockBtnBusy: { opacity: 0.6 },
  unblockText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: spacing.screen + 44 + spacing.md,
  },

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  });
}
