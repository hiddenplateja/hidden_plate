// app/(tabs)/community.tsx
// Community Feed — two tabs:
//   Following: reviews from people you follow (sorted chronologically)
//   For You:   personalized algorithmic feed using rankForYou()
//
// Algorithm (For You):
//   Each fetched batch is scored locally via signals: recency, likes,
//   followed authors, saved restaurants, same parish, restaurant quality,
//   random jitter. See utils/forYouRanking.ts to tune weights.
//   Falls back to "popular + recent" when personalization data is empty.
//
// Note: Appwrite realtime (client.subscribe) was deferred — it needs
// AsyncStorage native-linked, which requires a fresh EAS-built dev client
// installed on device. Once we install today's EAS APK on a clean device
// (or wipe the emulator), we can paste the realtime useEffect back here.
// In the meantime, pull-to-refresh re-fetches latest counts.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { getFollowingIds } from "@/services/follows";
import { reportReview } from "@/services/reports";
import { getRestaurantsByIds } from "@/services/restaurants";
import {
  getLikedReviewIds,
  likeReview,
  unlikeReview,
} from "@/services/reviewLikes";
import {
  deleteReview,
  listLatestReviews,
  listReviewsByFollowing,
} from "@/services/reviews";
import { listSavedByUser } from "@/services/saved";
import { getImageViewUrl } from "@/services/storage";
import { getUsersByIds } from "@/services/users";
import {
  colors,
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { Parish, Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";
import { rankForYou, type RankingContext } from "@/utils/forYouRanking";

const { width: SW } = Dimensions.get("window");

const BATCH_SIZE = 50;
const FOLLOWING_BATCH = 20;

type FeedTab = "following" | "for_you";

interface FeedItem {
  review: Review;
  author: User | null;
  restaurant: Restaurant | null;
}

interface FeedState {
  items: FeedItem[];
  likedIds: Set<string>;
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  notFollowingAnyone: boolean;
}

const EMPTY_FEED: FeedState = {
  items: [],
  likedIds: new Set(),
  nextCursor: null,
  hasMore: false,
  loading: true,
  refreshing: false,
  loadingMore: false,
  notFollowingAnyone: false,
};

const PARISH_LABELS: Record<Parish, string> = {
  kingston: "Kingston",
  st_andrew: "St. Andrew",
  st_thomas: "St. Thomas",
  portland: "Portland",
  st_mary: "St. Mary",
  st_ann: "St. Ann",
  trelawny: "Trelawny",
  st_james: "St. James",
  hanover: "Hanover",
  westmoreland: "Westmoreland",
  st_elizabeth: "St. Elizabeth",
  manchester: "Manchester",
  clarendon: "Clarendon",
  st_catherine: "St. Catherine",
};

function parishFromLocation(lat: number, lng: number): Parish | null {
  if (lat > 18.42 && lng < -77.85) return "hanover";
  if (lat > 18.4 && lng < -77.7) return "st_james";
  if (lat > 18.4 && lng < -77.55) return "trelawny";
  if (lat > 18.4 && lng < -77.15) return "st_ann";
  if (lat > 18.35 && lng < -76.85) return "st_mary";
  if (lat > 18.15 && lng < -76.3) return "portland";
  if (lat < 17.9 && lng < -78.2) return "westmoreland";
  if (lat < 18.15 && lng < -77.95) return "westmoreland";
  if (lat < 18.15 && lng < -77.55) return "st_elizabeth";
  if (lat < 18.2 && lng < -77.4) return "manchester";
  if (lat < 18.0 && lng < -77.15) return "clarendon";
  if (lat < 18.1 && lng < -76.85) return "st_catherine";
  if (lat < 18.05 && lng < -76.65) return "kingston";
  if (lat < 18.3 && lng < -76.65) return "st_andrew";
  if (lat < 18.2 && lng < -76.3) return "st_thomas";
  return null;
}

function formatTimeAgo(iso: string): string {
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

function buildShareMessage(item: FeedItem): string {
  const author = item.author?.displayName ?? "Someone";
  const restaurant = item.restaurant?.name ?? "a restaurant";
  const rating = "★".repeat(item.review.rating);
  const snippet = item.review.comment
    ? `\n\n"${item.review.comment.slice(0, 140)}${
        item.review.comment.length > 140 ? "…" : ""
      }"`
    : "";
  return `${author} reviewed ${restaurant} on Hidden Plate ${rating}${snippet}`;
}

export default function CommunityScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<FeedTab>("following");
  const [following, setFollowing] = useState<FeedState>(EMPTY_FEED);
  const [forYou, setForYou] = useState<FeedState>(EMPTY_FEED);
  const [reviewToManage, setReviewToManage] = useState<Review | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [activePhotoSet, setActivePhotoSet] = useState<string[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);

  const rankingCtxRef = useRef<RankingContext>({
    followedAuthorIds: new Set(),
    savedRestaurantIds: new Set(),
    userParish: null,
  });

  const loaded = useRef<Record<FeedTab, boolean>>({
    following: false,
    for_you: false,
  });

  const hydrate = useCallback(
    async (reviews: Review[]): Promise<FeedItem[]> => {
      if (reviews.length === 0) return [];
      const authorIds = reviews.map((r) => r.userId);
      const restaurantIds = reviews.map((r) => r.restaurantId);
      const [authors, restaurants] = await Promise.all([
        getUsersByIds(authorIds),
        getRestaurantsByIds(restaurantIds),
      ]);
      return reviews.map((review) => ({
        review,
        author: authors.get(review.userId) ?? null,
        restaurant: restaurants.get(review.restaurantId) ?? null,
      }));
    },
    [],
  );

  const buildRankingContext = useCallback(async (): Promise<RankingContext> => {
    if (!user) {
      return {
        followedAuthorIds: new Set(),
        savedRestaurantIds: new Set(),
        userParish: null,
      };
    }

    const [followingIds, savedDocs, parish] = await Promise.all([
      getFollowingIds(user.id).catch(() => [] as string[]),
      listSavedByUser().catch(() => []),
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== "granted") return null;
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
          });
          return parishFromLocation(loc.coords.latitude, loc.coords.longitude);
        } catch {
          return null;
        }
      })(),
    ]);

    return {
      followedAuthorIds: new Set(followingIds),
      savedRestaurantIds: new Set(savedDocs.map((d) => d.restaurantId)),
      userParish: parish,
    };
  }, [user]);

  const loadFollowing = useCallback(
    async (isRefresh = false) => {
      if (!user) return;
      setFollowing((prev) => ({
        ...prev,
        loading: !isRefresh,
        refreshing: isRefresh,
      }));

      try {
        const followingIds = await getFollowingIds(user.id);

        if (followingIds.length === 0) {
          setFollowing({
            ...EMPTY_FEED,
            loading: false,
            notFollowingAnyone: true,
          });
          loaded.current.following = true;
          return;
        }

        const page = await listReviewsByFollowing(followingIds, {
          pageSize: FOLLOWING_BATCH,
        });
        const items = await hydrate(page.items);
        const likedIds = await getLikedReviewIds(page.items.map((r) => r.id));

        setFollowing({
          items,
          likedIds,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loading: false,
          refreshing: false,
          loadingMore: false,
          notFollowingAnyone: false,
        });
        loaded.current.following = true;
      } catch (err) {
        console.warn("[community] loadFollowing failed:", err);
        setFollowing((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
        }));
      }
    },
    [user, hydrate],
  );

  const loadMoreFollowing = useCallback(async () => {
    if (!user || !following.hasMore || following.loadingMore) return;
    const followingIds = await getFollowingIds(user.id);
    if (followingIds.length === 0) return;

    setFollowing((prev) => ({ ...prev, loadingMore: true }));
    try {
      const page = await listReviewsByFollowing(followingIds, {
        pageSize: FOLLOWING_BATCH,
        cursor: following.nextCursor,
      });
      const newItems = await hydrate(page.items);
      const newLiked = await getLikedReviewIds(page.items.map((r) => r.id));

      setFollowing((prev) => ({
        ...prev,
        items: [...prev.items, ...newItems],
        likedIds: new Set([...prev.likedIds, ...newLiked]),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadingMore: false,
      }));
    } catch {
      setFollowing((prev) => ({ ...prev, loadingMore: false }));
    }
  }, [user, following, hydrate]);

  const loadForYou = useCallback(
    async (isRefresh = false) => {
      setForYou((prev) => ({
        ...prev,
        loading: !isRefresh,
        refreshing: isRefresh,
      }));

      try {
        if (isRefresh || !loaded.current.for_you) {
          rankingCtxRef.current = await buildRankingContext();
        }

        const page = await listLatestReviews({ pageSize: BATCH_SIZE });
        const items = await hydrate(page.items);

        const ranked = rankForYou(
          items.map((i) => ({ review: i.review, restaurant: i.restaurant })),
          rankingCtxRef.current,
        );

        const itemById = new Map(items.map((i) => [i.review.id, i]));
        const rankedFeedItems: FeedItem[] = ranked.map((r) => {
          const original = itemById.get(r.review.id);
          return {
            review: r.review,
            author: original?.author ?? null,
            restaurant: r.restaurant,
          };
        });

        const likedIds = await getLikedReviewIds(page.items.map((r) => r.id));

        setForYou({
          items: rankedFeedItems,
          likedIds,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loading: false,
          refreshing: false,
          loadingMore: false,
          notFollowingAnyone: false,
        });
        loaded.current.for_you = true;
      } catch (err) {
        console.warn("[community] loadForYou failed:", err);
        setForYou((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
        }));
      }
    },
    [hydrate, buildRankingContext],
  );

  const loadMoreForYou = useCallback(async () => {
    if (!forYou.hasMore || forYou.loadingMore) return;
    setForYou((prev) => ({ ...prev, loadingMore: true }));
    try {
      const page = await listLatestReviews({
        pageSize: BATCH_SIZE,
        cursor: forYou.nextCursor,
      });
      const newItems = await hydrate(page.items);

      const ranked = rankForYou(
        newItems.map((i) => ({ review: i.review, restaurant: i.restaurant })),
        rankingCtxRef.current,
      );
      const itemById = new Map(newItems.map((i) => [i.review.id, i]));
      const rankedFeedItems: FeedItem[] = ranked.map((r) => {
        const original = itemById.get(r.review.id);
        return {
          review: r.review,
          author: original?.author ?? null,
          restaurant: r.restaurant,
        };
      });

      const newLiked = await getLikedReviewIds(page.items.map((r) => r.id));

      setForYou((prev) => ({
        ...prev,
        items: [...prev.items, ...rankedFeedItems],
        likedIds: new Set([...prev.likedIds, ...newLiked]),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadingMore: false,
      }));
    } catch {
      setForYou((prev) => ({ ...prev, loadingMore: false }));
    }
  }, [forYou, hydrate]);

  useFocusEffect(
    useCallback(() => {
      if (!loaded.current.following) loadFollowing();
      if (!loaded.current.for_you) loadForYou();
    }, [loadFollowing, loadForYou]),
  );

  const handleRefresh = useCallback(() => {
    loaded.current[activeTab] = false;
    if (activeTab === "following") loadFollowing(true);
    else loadForYou(true);
  }, [activeTab, loadFollowing, loadForYou]);

  const handleToggleLike = useCallback(
    async (reviewId: string, restaurantId: string, currentlyLiked: boolean) => {
      const setter = activeTab === "following" ? setFollowing : setForYou;

      setter((prev) => {
        const nextLiked = new Set(prev.likedIds);
        if (currentlyLiked) nextLiked.delete(reviewId);
        else nextLiked.add(reviewId);
        const nextItems = prev.items.map((item) =>
          item.review.id === reviewId
            ? {
                ...item,
                review: {
                  ...item.review,
                  likeCount: Math.max(
                    0,
                    item.review.likeCount + (currentlyLiked ? -1 : 1),
                  ),
                },
              }
            : item,
        );
        return { ...prev, items: nextItems, likedIds: nextLiked };
      });

      try {
        if (currentlyLiked) await unlikeReview(reviewId);
        else await likeReview(reviewId, restaurantId);
      } catch {
        setter((prev) => {
          const nextLiked = new Set(prev.likedIds);
          if (currentlyLiked) nextLiked.add(reviewId);
          else nextLiked.delete(reviewId);
          const nextItems = prev.items.map((item) =>
            item.review.id === reviewId
              ? {
                  ...item,
                  review: {
                    ...item.review,
                    likeCount: Math.max(
                      0,
                      item.review.likeCount + (currentlyLiked ? 1 : -1),
                    ),
                  },
                }
              : item,
          );
          return { ...prev, items: nextItems, likedIds: nextLiked };
        });
      }
    },
    [activeTab],
  );

  // Native share sheet, text-only message
  const handleShare = useCallback(async (item: FeedItem) => {
    try {
      await Share.share({
        message: buildShareMessage(item),
      });
    } catch (err) {
      console.warn("[community] share failed:", err);
    }
  }, []);

  const handleDeleteReview = useCallback(async (review: Review) => {
    try {
      await deleteReview(review.id);
      setFollowing((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.review.id !== review.id),
      }));
      setForYou((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.review.id !== review.id),
      }));
    } catch (err) {
      Alert.alert(
        "Couldn't delete",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const handleReportReview = useCallback(async (review: Review) => {
    setHiddenIds((p) => new Set(p).add(review.id));
    setReviewToManage(null);
    try {
      await reportReview(review.id, review.restaurantId, "inappropriate");
      Alert.alert("Reported", "Thank you for keeping our community safe.");
    } catch {}
  }, []);

  const currentFeed = activeTab === "following" ? following : forYou;
  const visibleItems = currentFeed.items.filter(
    (i) => !hiddenIds.has(i.review.id),
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      const { review, author, restaurant } = item;
      const isLiked = currentFeed.likedIds.has(review.id);
      const isOwn = user?.id === review.userId;
      const parishText = restaurant
        ? (PARISH_LABELS[restaurant.parish] ?? restaurant.parish)
        : null;
      const coverFileId =
        restaurant?.coverImageId ?? restaurant?.imageIds[0] ?? null;
      const coverUrl = coverFileId ? getImageViewUrl(coverFileId) : null;

      return (
        <Animated.View
          entering={FadeInDown.delay(Math.min(index, 5) * 60).springify()}
        >
          <Pressable
            style={({ pressed }) => [
              cardStyles.card,
              pressed && cardStyles.cardPressed,
            ]}
            onPress={() => router.push(`/review/${review.id}`)}
            accessibilityRole="button"
          >
            <View style={cardStyles.authorRow}>
              <Pressable
                style={cardStyles.authorInfo}
                onPress={() => router.push(`/profile/${review.userId}`)}
                accessibilityRole="button"
                accessibilityLabel={`View ${author?.displayName ?? "user"}'s profile`}
              >
                <AuthorAvatar author={author} userId={review.userId} />
                <View style={cardStyles.authorText}>
                  <Text style={cardStyles.authorName} numberOfLines={1}>
                    {author?.displayName ?? "Hidden Plate user"}
                  </Text>
                  {author?.username ? (
                    <Text style={cardStyles.authorHandle}>
                      @{author.username} · {formatTimeAgo(review.createdAt)}
                    </Text>
                  ) : (
                    <Text style={cardStyles.authorHandle}>
                      {formatTimeAgo(review.createdAt)}
                    </Text>
                  )}
                </View>
              </Pressable>

              <Pressable
                onPress={() => setReviewToManage(review)}
                hitSlop={8}
                style={cardStyles.moreBtn}
                accessibilityRole="button"
                accessibilityLabel="More options"
              >
                <MaterialCommunityIcons
                  name="dots-horizontal"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>

            <Pressable
              style={cardStyles.restaurantTag}
              onPress={(e) => {
                e.stopPropagation?.();
                router.push(`/restaurant/${review.restaurantId}`);
              }}
            >
              <MaterialCommunityIcons
                name="map-marker"
                size={12}
                color={colors.primary}
              />
              <Text style={cardStyles.restaurantTagText} numberOfLines={1}>
                Reviewed{" "}
                <Text style={cardStyles.restaurantTagBold}>
                  {restaurant?.name ?? "a restaurant"}
                </Text>
                {parishText ? (
                  <Text style={cardStyles.restaurantTagParish}>
                    {" "}
                    · {parishText}
                  </Text>
                ) : null}
              </Text>
            </Pressable>

            <View style={cardStyles.starsRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <MaterialCommunityIcons
                  key={i}
                  name={i <= review.rating ? "star" : "star-outline"}
                  size={15}
                  color={i <= review.rating ? colors.star : colors.border}
                />
              ))}
            </View>

            {review.comment ? (
              <Text style={cardStyles.comment} numberOfLines={6}>
                {review.comment}
              </Text>
            ) : null}

            {review.imageIds.length > 0 ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  setActivePhotoSet(review.imageIds);
                  setActivePhotoIndex(0);
                }}
                style={cardStyles.photoWrap}
              >
                <Image
                  source={{ uri: getImageViewUrl(review.imageIds[0]) }}
                  style={cardStyles.photo}
                  contentFit="cover"
                  transition={250}
                  cachePolicy="memory-disk"
                />
                {review.imageIds.length > 1 ? (
                  <View style={cardStyles.photoBadge}>
                    <Text style={cardStyles.photoBadgeText}>
                      +{review.imageIds.length - 1}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ) : null}

            {review.imageIds.length === 0 && coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
                style={cardStyles.restaurantCover}
                contentFit="cover"
                transition={250}
                cachePolicy="memory-disk"
              />
            ) : null}

            {/* Footer: Like · Comment · Share */}
            <View style={cardStyles.footer}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  handleToggleLike(review.id, review.restaurantId, isLiked);
                }}
                disabled={isOwn}
                style={({ pressed }) => [
                  cardStyles.actionBtn,
                  pressed && { opacity: 0.6 },
                  isOwn && { opacity: 0.4 },
                ]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={isLiked ? "Unlike" : "Like"}
              >
                <MaterialCommunityIcons
                  name={isLiked ? "heart" : "heart-outline"}
                  size={20}
                  color={isLiked ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    cardStyles.actionCount,
                    isLiked && cardStyles.actionCountActive,
                  ]}
                >
                  {review.likeCount}
                </Text>
              </Pressable>

              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  router.push(`/review/${review.id}`);
                }}
                style={({ pressed }) => [
                  cardStyles.actionBtn,
                  pressed && { opacity: 0.6 },
                ]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="View comments"
              >
                <MaterialCommunityIcons
                  name="comment-outline"
                  size={19}
                  color={colors.textMuted}
                />
                <Text style={cardStyles.actionCount}>
                  {review.commentCount ?? 0}
                </Text>
              </Pressable>

              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  handleShare(item);
                }}
                style={({ pressed }) => [
                  cardStyles.actionBtn,
                  pressed && { opacity: 0.6 },
                ]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Share"
              >
                <MaterialCommunityIcons
                  name="share-outline"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [currentFeed.likedIds, user, handleToggleLike, handleShare, router],
  );

  const tabs = [
    { id: "following" as const, label: "Following" },
    { id: "for_you" as const, label: "For You" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Animated.View entering={FadeIn.duration(400)} style={styles.header}>
        <Text style={styles.title}>Community</Text>
      </Animated.View>

      <View style={styles.tabsBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[styles.tabLabel, isActive && styles.tabLabelActive]}
              >
                {tab.label}
              </Text>
              <View
                style={[
                  styles.tabUnderline,
                  isActive && styles.tabUnderlineActive,
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {currentFeed.loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading feed…</Text>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.review.id}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={5}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          onEndReached={
            activeTab === "following" ? loadMoreFollowing : loadMoreForYou
          }
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={currentFeed.refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            currentFeed.loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Animated.View
              entering={FadeInDown.springify()}
              style={styles.emptyContainer}
            >
              {activeTab === "following" && currentFeed.notFollowingAnyone ? (
                <>
                  <View style={styles.emptyIconWrap}>
                    <MaterialCommunityIcons
                      name="account-group-outline"
                      size={32}
                      color={colors.primary}
                    />
                  </View>
                  <Text style={styles.emptyTitle}>Your feed is quiet!</Text>
                  <Text style={styles.emptyBody}>
                    Follow other foodies to see their reviews here. Find people
                    by tapping their name on any review.
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.emptyIconWrap}>
                    <MaterialCommunityIcons
                      name="silverware-fork-knife"
                      size={32}
                      color={colors.primary}
                    />
                  </View>
                  <Text style={styles.emptyTitle}>No reviews yet</Text>
                  <Text style={styles.emptyBody}>
                    Be the first to share a hidden gem!
                  </Text>
                </>
              )}
            </Animated.View>
          }
        />
      )}

      <Modal
        visible={!!reviewToManage}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewToManage(null)}
      >
        <Pressable
          style={sheetStyles.overlay}
          onPress={() => setReviewToManage(null)}
        >
          <View style={sheetStyles.sheet}>
            <View style={sheetStyles.handle} />
            <Text style={sheetStyles.title}>Manage Review</Text>

            {reviewToManage?.userId === user?.id ? (
              <Pressable
                style={sheetStyles.item}
                onPress={() => {
                  const r = reviewToManage;
                  setReviewToManage(null);
                  Alert.alert("Delete Review?", "This can't be undone.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => r && handleDeleteReview(r),
                    },
                  ]);
                }}
              >
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={22}
                  color={colors.error}
                />
                <Text style={[sheetStyles.itemText, { color: colors.error }]}>
                  Delete Review
                </Text>
              </Pressable>
            ) : (
              <Pressable
                style={sheetStyles.item}
                onPress={() => {
                  const r = reviewToManage;
                  setReviewToManage(null);
                  Alert.alert(
                    "Report Review",
                    "Report this as inappropriate?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Report",
                        style: "destructive",
                        onPress: () => r && handleReportReview(r),
                      },
                    ],
                  );
                }}
              >
                <MaterialCommunityIcons
                  name="flag-outline"
                  size={22}
                  color={colors.error}
                />
                <Text style={[sheetStyles.itemText, { color: colors.error }]}>
                  Report as Inappropriate
                </Text>
              </Pressable>
            )}

            <Pressable
              style={sheetStyles.cancelBtn}
              onPress={() => setReviewToManage(null)}
            >
              <Text style={sheetStyles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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
    </SafeAreaView>
  );
}

function AuthorAvatar({
  author,
  userId,
}: {
  author: User | null;
  userId: string;
}) {
  const { Avatar } =
    require("@/components/Avatar") as typeof import("@/components/Avatar");
  return (
    <Avatar
      fileId={author?.avatarUrl}
      displayName={author?.displayName ?? "Hidden Plate user"}
      userId={userId}
      size={42}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  header: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    alignItems: "center",
  },
  title: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    textAlign: "center",
  },
  tabsBar: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.md,
    paddingBottom: 0,
  },
  tabLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  tabLabelActive: {
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  tabUnderline: {
    height: 3,
    width: 36,
    borderRadius: 2,
    backgroundColor: "transparent",
  },
  tabUnderlineActive: {
    backgroundColor: colors.primary,
  },
  list: { backgroundColor: colors.cardBackground },
  listContent: { paddingTop: spacing.md, paddingBottom: 100 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  footerLoader: { paddingVertical: spacing.lg, alignItems: "center" },
  emptyContainer: {
    alignItems: "center",
    paddingTop: spacing.huge,
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
    letterSpacing: T.tracking.tight,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    marginHorizontal: spacing.screen,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.sm,
  },
  cardPressed: { opacity: 0.97 },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  authorInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
  },
  authorText: { flex: 1 },
  authorName: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  authorHandle: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.divider,
  },
  restaurantTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    marginBottom: spacing.md,
    gap: 4,
  },
  restaurantTagText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  restaurantTagBold: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  restaurantTagParish: {
    fontFamily: fonts.regular,
    color: colors.primary,
    opacity: 0.8,
  },
  starsRow: {
    flexDirection: "row",
    gap: 2,
    marginBottom: spacing.md,
  },
  comment: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  photoWrap: {
    position: "relative",
    marginBottom: spacing.md,
  },
  photo: {
    width: "100%",
    height: 210,
    borderRadius: radius.lg,
    backgroundColor: colors.pageBackground,
  },
  photoBadge: {
    position: "absolute",
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  photoBadgeText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.white,
  },
  restaurantCover: {
    width: "100%",
    height: 160,
    borderRadius: radius.lg,
    backgroundColor: colors.pageBackground,
    marginBottom: spacing.md,
    opacity: 0.85,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 4,
  },
  actionCount: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  actionCountActive: { color: colors.primary },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xxl,
    paddingBottom: Platform.OS === "ios" ? 40 : spacing.xxl,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.divider,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  itemText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  cancelBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
  },
  cancelText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
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
