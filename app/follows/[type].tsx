// app/follows/[type].tsx
// Followers / Following list screen.
//
// Route patterns:
//   /follows/followers?userId=<userId>  — who follows the target user
//   /follows/following?userId=<userId>  — who the target user follows
//
// Behavior:
//   - Paginated list of users
//   - Each row: avatar, name, @handle, optional bio (1 line)
//   - Follow / Following button per row (only when row isn't the current user)
//   - Tap row → that user's profile
//   - Empty state with friendly icon

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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

import { UserRow } from "@/components/UserRow";
import { useAuth } from "@/hooks/useAuth";
import {
    followUser,
    getFollowingSetForUsers,
    listFollowers,
    listFollowing,
    unfollowUser,
    type FollowListPage,
} from "@/services/follows";
import { getUserById } from "@/services/users";
import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { User } from "@/types/user";

type FollowType = "followers" | "following";

interface Data {
  users: User[];
  followingSet: Set<string>;
  nextCursor: string | null;
  hasMore: boolean;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Data; targetUser: User | null };

export default function FollowsListScreen() {
  const { type, userId } = useLocalSearchParams<{
    type: FollowType;
    userId: string;
  }>();
  const router = useRouter();
  const { user: me } = useAuth();

  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const isFollowersList = type === "followers";

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<FollowListPage> => {
      if (isFollowersList) {
        return listFollowers(userId, { cursor });
      }
      return listFollowing(userId, { cursor });
    },
    [isFollowersList, userId],
  );

  const load = useCallback(
    async (isRefresh = false) => {
      if (!userId || !type) {
        setState({ status: "error", message: "Missing data." });
        return;
      }
      if (!isRefresh) setState({ status: "loading" });
      try {
        const [page, targetUser] = await Promise.all([
          fetchPage(null),
          getUserById(userId),
        ]);
        const followingSet = await getFollowingSetForUsers(
          page.items.map((u) => u.id),
        );
        setState({
          status: "ready",
          data: {
            users: page.items,
            followingSet,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          targetUser,
        });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load.",
        });
      } finally {
        setRefreshing(false);
      }
    },
    [userId, type, fetchPage],
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const handleLoadMore = useCallback(async () => {
    if (state.status !== "ready" || !state.data.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(state.data.nextCursor);
      const newFollowingSet = await getFollowingSetForUsers(
        page.items.map((u) => u.id),
      );
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          ...prev,
          data: {
            users: [...prev.data.users, ...page.items],
            followingSet: new Set([
              ...prev.data.followingSet,
              ...newFollowingSet,
            ]),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        };
      });
    } catch (err) {
      console.warn("[follows-list] load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [state, fetchPage, loadingMore]);

  const handleToggleFollow = useCallback(
    async (targetId: string) => {
      if (state.status !== "ready") return;
      if (busyIds.has(targetId)) return;
      const wasFollowing = state.data.followingSet.has(targetId);

      // Optimistic
      setBusyIds((p) => new Set(p).add(targetId));
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const next = new Set(prev.data.followingSet);
        if (wasFollowing) next.delete(targetId);
        else next.add(targetId);
        return { ...prev, data: { ...prev.data, followingSet: next } };
      });

      try {
        if (wasFollowing) await unfollowUser(targetId);
        else await followUser(targetId);
      } catch (err) {
        // Revert
        setState((prev) => {
          if (prev.status !== "ready") return prev;
          const next = new Set(prev.data.followingSet);
          if (wasFollowing) next.add(targetId);
          else next.delete(targetId);
          return { ...prev, data: { ...prev.data, followingSet: next } };
        });
        Alert.alert(
          wasFollowing ? "Couldn't unfollow" : "Couldn't follow",
          err instanceof Error ? err.message : "Try again.",
        );
      } finally {
        setBusyIds((p) => {
          const next = new Set(p);
          next.delete(targetId);
          return next;
        });
      }
    },
    [state, busyIds],
  );

  const screenTitle = isFollowersList ? "Followers" : "Following";

  // ---------- Render ----------

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
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
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{screenTitle}</Text>
          {state.status === "ready" && state.targetUser ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              @{state.targetUser.username}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {state.status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : state.status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn&apos;t load</Text>
          <Text style={styles.errorMessage}>{state.message}</Text>
          <Pressable onPress={() => load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={state.data.users}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              isMe={me?.id === item.id}
              isFollowing={state.data.followingSet.has(item.id)}
              busy={busyIds.has(item.id)}
              onPress={() => router.push(`/profile/${item.id}`)}
              onToggleFollow={() => handleToggleFollow(item.id)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name={
                    isFollowersList
                      ? "account-group-outline"
                      : "account-multiple-outline"
                  }
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {isFollowersList
                  ? "No followers yet"
                  : "Not following anyone yet"}
              </Text>
              <Text style={styles.emptyBody}>
                {isFollowersList
                  ? state.targetUser
                    ? `${state.targetUser.displayName} doesn't have any followers yet.`
                    : "When people follow this account, they'll show up here."
                  : state.targetUser
                    ? `${state.targetUser.displayName} isn't following anyone yet.`
                    : "Find people by tapping their name on any review."}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
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
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
  },
  errorMessage: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  listContent: {
    paddingBottom: 100,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: spacing.screen + 48 + spacing.md,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing.huge,
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
