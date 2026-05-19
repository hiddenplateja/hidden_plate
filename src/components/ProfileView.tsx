// src/components/ProfileView.tsx
// Shared profile content for "my profile" and "view user" routes.
//
// Loads in parallel:
//   - user document
//   - review stats
//   - follower / following counts
//   - is-current-user-following-target boolean
//   - first page of reviews
//   - hydrated restaurants for those reviews
//
// Optimistic follow toggle: UI updates immediately; server call happens in
// the background; failure reverts state.
//
// Three content tabs: All reviews / Likes / Saved (icon-only).
//   "all"   → shows the user's reviews (working today)
//   "likes" → placeholder for now; needs a new likes-by-user query later
//   "saved" → placeholder for now; only meaningful on your own profile
//
// Visual: whole component is on the white cardBackground surface to match
// Community/Saved. The minimal stats row + content tabs together make up
// the FlatList header.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ProfileContentTabs,
  type ProfileContentTab,
} from "@/components/ProfileContentTabs";
import { ProfileHeader } from "@/components/ProfileHeader";
import { UserReviewItem } from "@/components/UserReviewItem";
import { Button } from "@/components/ui/Button";
import {
  isFollowing as checkIsFollowing,
  followUser,
  getFollowCounts,
  unfollowUser,
} from "@/services/follows";
import { getRestaurantsByIds } from "@/services/restaurants";
import { getUserReviewStats, listReviewsByUser } from "@/services/reviews";
import { getImageViewUrl } from "@/services/storage";
import { getUserById } from "@/services/users";
import {
  colors,
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

const { width: SW } = Dimensions.get("window");
const PAGE_SIZE = 20;

interface ProfileViewProps {
  userId: string;
  isOwn: boolean;
  variant?: "centered" | "default";
  onEditPress?: () => void;
  onSignOutPress?: () => void;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

interface Data {
  user: User;
  stats: {
    reviewCount: number;
    averageRating: number;
    parishesVisited: number;
  };
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  reviews: Review[];
  restaurants: Map<string, Restaurant>;
  nextCursor: string | null;
  hasMore: boolean;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Data };

export function ProfileView({
  userId,
  isOwn,
  variant = "default",
  onEditPress,
  onSignOutPress,
  onFollowersPress,
  onFollowingPress,
}: ProfileViewProps) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const [activePhotoSet, setActivePhotoSet] = useState<string[]>([]);

  // Active content tab — defaults to the user's own reviews
  const [activeTab, setActiveTab] = useState<ProfileContentTab>("all");

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setState({ status: "loading" });
      try {
        const [user, stats, followCounts, isFollowingTarget, page] =
          await Promise.all([
            getUserById(userId),
            getUserReviewStats(userId),
            getFollowCounts(userId),
            isOwn ? Promise.resolve(false) : checkIsFollowing(userId),
            listReviewsByUser(userId, { pageSize: PAGE_SIZE }),
          ]);

        if (!user) {
          setState({ status: "error", message: "User not found." });
          return;
        }

        const restaurantIds = page.items.map((r) => r.restaurantId);
        const restaurants = await getRestaurantsByIds(restaurantIds);

        setState({
          status: "ready",
          data: {
            user,
            stats,
            followerCount: followCounts.followerCount,
            followingCount: followCounts.followingCount,
            isFollowing: isFollowingTarget,
            reviews: page.items,
            restaurants,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
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
    [userId, isOwn],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const handleLoadMore = useCallback(async () => {
    if (state.status !== "ready" || !state.data.hasMore || loadingMore) return;
    // Only paginate the "all" tab for now — the other tabs are placeholders.
    if (activeTab !== "all") return;
    setLoadingMore(true);
    try {
      const page = await listReviewsByUser(userId, {
        pageSize: PAGE_SIZE,
        cursor: state.data.nextCursor,
      });
      const restaurantIds = page.items.map((r) => r.restaurantId);
      const newRestaurants = await getRestaurantsByIds(restaurantIds);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const mergedRestaurants = new Map([
          ...prev.data.restaurants,
          ...newRestaurants,
        ]);
        return {
          status: "ready",
          data: {
            ...prev.data,
            reviews: [...prev.data.reviews, ...page.items],
            restaurants: mergedRestaurants,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        };
      });
    } catch (err) {
      console.warn("[profile] load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [state, userId, activeTab, loadingMore]);

  const handleToggleFollow = useCallback(async () => {
    if (state.status !== "ready" || isOwn) return;
    const wasFollowing = state.data.isFollowing;

    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        status: "ready",
        data: {
          ...prev.data,
          isFollowing: !wasFollowing,
          followerCount: prev.data.followerCount + (wasFollowing ? -1 : 1),
        },
      };
    });

    try {
      if (wasFollowing) {
        await unfollowUser(userId);
      } else {
        await followUser(userId);
      }
    } catch (err) {
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: {
            ...prev.data,
            isFollowing: wasFollowing,
            followerCount: prev.data.followerCount + (wasFollowing ? 1 : -1),
          },
        };
      });
      Alert.alert(
        wasFollowing ? "Couldn't unfollow" : "Couldn't follow",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, [state, isOwn, userId]);

  const handleRestaurantPress = useCallback(
    (restaurantId: string) => {
      router.push(`/restaurant/${restaurantId}`);
    },
    [router],
  );

  const handlePhotoTap = useCallback(
    (imageIds: string[], startIndex: number) => {
      setActivePhotoSet(imageIds);
      setActivePhotoIndex(startIndex);
    },
    [],
  );

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <SafeAreaView style={styles.errorContainer} edges={["top"]}>
        <Text style={styles.errorTitle}>Couldn&apos;t load</Text>
        <Text style={styles.errorMessage}>{state.message}</Text>
        <Button label="Try again" onPress={() => load()} fullWidth={false} />
      </SafeAreaView>
    );
  }

  const {
    user,
    stats,
    reviews,
    restaurants,
    isFollowing,
    followerCount,
    followingCount,
  } = state.data;

  // Which list to feed into FlatList based on active tab.
  // "all" is the real data; the other tabs are empty for now and will show
  // a placeholder via ListEmptyComponent.
  const listData = activeTab === "all" ? reviews : [];

  return (
    <View style={styles.wrap}>
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <UserReviewItem
            review={item}
            restaurant={restaurants.get(item.restaurantId) ?? null}
            onPress={handleRestaurantPress}
            onPhotoTap={handlePhotoTap}
          />
        )}
        ListHeaderComponent={
          <>
            <ProfileHeader
              user={user}
              stats={stats}
              follow={{
                followerCount,
                followingCount,
                isFollowing,
              }}
              isOwn={isOwn}
              variant={variant}
              onEditPress={onEditPress}
              onToggleFollow={!isOwn ? handleToggleFollow : undefined}
              onFollowersPress={onFollowersPress}
              onFollowingPress={onFollowingPress}
            />
            <ProfileContentTabs active={activeTab} onChange={setActiveTab} />
          </>
        }
        ListEmptyComponent={
          activeTab === "all" ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="comment-text-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {isOwn ? "You haven't reviewed anything yet" : "No reviews yet"}
              </Text>
              <Text style={styles.emptyBody}>
                {isOwn
                  ? "Find a place you've eaten at and share your thoughts."
                  : `${user.displayName} hasn't shared any reviews.`}
              </Text>
            </View>
          ) : activeTab === "likes" ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="heart-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>Likes coming soon</Text>
              <Text style={styles.emptyBody}>
                Reviews you like will appear here.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="bookmark-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>Saved coming soon</Text>
              <Text style={styles.emptyBody}>
                Restaurants you save will appear here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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

      <Modal
        visible={activePhotoIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActivePhotoIndex(null)}
      >
        <View style={photoStyles.overlay}>
          <SafeAreaView style={{ flex: 1 }}>
            <Pressable
              style={photoStyles.closeBtn}
              onPress={() => setActivePhotoIndex(null)}
              hitSlop={10}
            >
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={colors.white}
              />
            </Pressable>
            <FlatList
              data={activePhotoSet}
              keyExtractor={(id, i) => `viewer-${id}-${i}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={activePhotoIndex ?? 0}
              getItemLayout={(_, index) => ({
                length: SW,
                offset: SW * index,
                index,
              })}
              renderItem={({ item: fileId }) => (
                <View style={{ width: SW, justifyContent: "center" }}>
                  <Image
                    source={{ uri: getImageViewUrl(fileId) }}
                    style={{ width: SW, height: SW * 1.1 }}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                </View>
              )}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Make the whole component sit on the white surface
  wrap: { flex: 1, backgroundColor: colors.cardBackground },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBackground,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBackground,
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
    marginBottom: spacing.md,
  },
  listContent: { paddingBottom: 100 },
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
  footerLoader: { paddingVertical: spacing.lg },
});

const photoStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  closeBtn: {
    position: "absolute",
    top: spacing.xl,
    right: spacing.screen,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
});
