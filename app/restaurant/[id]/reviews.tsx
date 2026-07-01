// app/restaurant/[id]/reviews.tsx
// Full paginated reviews list for a restaurant.
// Reached by tapping "See all" on the detail screen.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReviewItem } from "@/components/ReviewItem";
import { StarRating } from "@/components/StarRating";
import { useAuth } from "@/hooks/useAuth";
import { blockUser, getHiddenUserIds } from "@/services/blocks";
import { reportReview } from "@/services/reports";
import { getRestaurantById } from "@/services/restaurants";
import {
    getLikedReviewIds,
    likeReview,
    unlikeReview,
} from "@/services/reviewLikes";
import {
    getOwnerResponsesForReviews,
    type ReviewResponse,
} from "@/services/reviewResponses";
import {
    deleteReview,
    getRestaurantRatingDistribution,
    listReviewsForRestaurant,
} from "@/services/reviews";
import { captureError } from "@/services/sentry";
import { getUsersByIds } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { RatingDistribution, RatingValue, Review } from "@/types/review";
import type { User } from "@/types/user";

type SortMode = "recent" | "popular";

interface PageData {
  reviews: Review[];
  reviewAuthors: Map<string, User>;
  likedIds: Set<string>;
  nextCursor: string | null;
  hasMore: boolean;
}

export default function AllReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);
  const sheetStyles = useThemedStyles(makeSheetStyles).styles;

  const [data, setData] = useState<PageData | null>(null);
  const [dist, setDist] = useState<RatingDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<SortMode>("recent");
  // hiddenIds = reviews hidden after reporting (by review id).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // blockedUserIds = mutual block set (people I blocked + who blocked me),
  // by author id. Their reviews are filtered out. Tolerant — empty on failure.
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [likeBusy, setLikeBusy] = useState<Set<string>>(new Set());
  const [reviewToManage, setReviewToManage] = useState<Review | null>(null);
  // Owner of this restaurant + their replies (by review id), shown inline.
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Map<string, ReviewResponse>>(
    new Map(),
  );

  const load = useCallback(
    async (sortMode: SortMode) => {
      if (!id) return;
      setLoading(true);
      try {
        const page = await listReviewsForRestaurant(id, {
          sort: sortMode,
          pageSize: 20,
        });
        const authorIds = page.items.map((r) => r.userId);
        const [authors, liked] = await Promise.all([
          getUsersByIds(authorIds),
          getLikedReviewIds(page.items.map((r) => r.id)),
        ]);
        setData({
          reviews: page.items,
          reviewAuthors: authors,
          likedIds: liked,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        });
      } catch (err) {
        Alert.alert(
          "Couldn't load reviews",
          err instanceof Error ? err.message : "Try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    load(sort);
  }, [load, sort]);

  // Rating distribution is the same regardless of sort, so fetch it once
  // per restaurant. Kept separate from `load` so changing the sort doesn't
  // re-fetch (or flicker) the histogram.
  useEffect(() => {
    if (!id) return;
    let active = true;
    getRestaurantRatingDistribution(id).then((d) => {
      if (active) setDist(d);
    });
    return () => {
      active = false;
    };
  }, [id]);

  // The restaurant's owner — needed to fetch + scope owner replies.
  useEffect(() => {
    if (!id) return;
    let active = true;
    getRestaurantById(id)
      .then((r) => {
        if (active) setOwnerId(r.ownerId);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  // Owner replies for the currently-loaded reviews (scoped to the owner, so a
  // forged reply by a non-owner never shows). Tolerant — empty map on failure.
  useEffect(() => {
    const reviews = data?.reviews;
    if (!reviews || reviews.length === 0 || !ownerId) {
      setResponses(new Map());
      return;
    }
    let active = true;
    getOwnerResponsesForReviews(
      reviews.map((r) => r.id),
      ownerId,
    ).then((m) => {
      if (active) setResponses(m);
    });
    return () => {
      active = false;
    };
  }, [data?.reviews, ownerId]);

  // Load the mutual block set once on mount. Tolerant: a failure just means
  // the list isn't filtered, not that it breaks.
  useEffect(() => {
    let active = true;
    getHiddenUserIds().then((ids) => {
      if (active) setBlockedUserIds(ids);
    });
    return () => {
      active = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!data?.hasMore || loadingMore || !id) return;
    setLoadingMore(true);
    try {
      const page = await listReviewsForRestaurant(id, {
        sort,
        pageSize: 20,
        cursor: data.nextCursor,
      });
      const authorIds = page.items.map((r) => r.userId);
      const [newAuthors, newLiked] = await Promise.all([
        getUsersByIds(authorIds),
        getLikedReviewIds(page.items.map((r) => r.id)),
      ]);
      setData((prev) => {
        if (!prev) return prev;
        const mergedAuthors = new Map([...prev.reviewAuthors, ...newAuthors]);
        const mergedLiked = new Set([...prev.likedIds, ...newLiked]);
        return {
          reviews: [...prev.reviews, ...page.items],
          reviewAuthors: mergedAuthors,
          likedIds: mergedLiked,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        };
      });
    } catch (err) {
      console.warn("[reviews] loadMore failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [data, loadingMore, id, sort]);

  const handleToggleLike = useCallback(
    async (reviewId: string, currentlyLiked: boolean) => {
      if (!data || !id) return;
      setLikeBusy((p) => new Set(p).add(reviewId));
      setData((prev) => {
        if (!prev) return prev;
        const nextLiked = new Set(prev.likedIds);
        if (currentlyLiked) nextLiked.delete(reviewId);
        else nextLiked.add(reviewId);
        const nextReviews = prev.reviews.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                likeCount: Math.max(0, r.likeCount + (currentlyLiked ? -1 : 1)),
              }
            : r,
        );
        return { ...prev, reviews: nextReviews, likedIds: nextLiked };
      });
      try {
        if (currentlyLiked) await unlikeReview(reviewId);
        else await likeReview(reviewId, id);
      } catch (err) {
        Alert.alert(
          "Couldn't update like",
          err instanceof Error ? err.message : "Try again.",
        );
        setData((prev) => {
          if (!prev) return prev;
          const nextLiked = new Set(prev.likedIds);
          if (currentlyLiked) nextLiked.add(reviewId);
          else nextLiked.delete(reviewId);
          const nextReviews = prev.reviews.map((r) =>
            r.id === reviewId
              ? {
                  ...r,
                  likeCount: Math.max(
                    0,
                    r.likeCount + (currentlyLiked ? 1 : -1),
                  ),
                }
              : r,
          );
          return { ...prev, reviews: nextReviews, likedIds: nextLiked };
        });
      } finally {
        setLikeBusy((p) => {
          const n = new Set(p);
          n.delete(reviewId);
          return n;
        });
      }
    },
    [data, id],
  );

  const handleDeleteReview = useCallback(async (review: Review) => {
    try {
      await deleteReview(review.id);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          reviews: prev.reviews.filter((r) => r.id !== review.id),
        };
      });
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

  // Block the author of a review. Optimistic: add to blockedUserIds so their
  // reviews vanish immediately; revert on error.
  const handleBlockUser = useCallback(async (review: Review) => {
    const targetId = review.userId;
    setReviewToManage(null);
    setBlockedUserIds((p) => new Set(p).add(targetId));
    try {
      await blockUser(targetId);
    } catch (err) {
      setBlockedUserIds((p) => {
        const next = new Set(p);
        next.delete(targetId);
        return next;
      });
      captureError(err, {
        screen: "restaurantReviews",
        op: "blockUser",
        targetUserId: targetId,
      });
      Alert.alert(
        "Couldn't block",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const visibleReviews =
    data?.reviews.filter(
      (r) => !hiddenIds.has(r.id) && !blockedUserIds.has(r.userId),
    ) ?? [];

  // Author of the review currently in the manage sheet — drives the
  // "Block @username" label + confirm copy.
  const manageAuthor = reviewToManage
    ? (data?.reviewAuthors.get(reviewToManage.userId) ?? null)
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
        <Text style={styles.headerTitle}>Reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Rating histogram — average + per-star distribution. Hidden until
          loaded and only shown when there's at least one rating. */}
      {dist && dist.count > 0 ? <RatingSummary dist={dist} /> : null}

      {/* Sort toggle */}
      <View style={styles.sortRow}>
        <Pressable
          onPress={() => setSort("recent")}
          style={[styles.sortBtn, sort === "recent" && styles.sortBtnActive]}
        >
          <Text
            style={[
              styles.sortText,
              sort === "recent" && styles.sortTextActive,
            ]}
          >
            Most recent
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSort("popular")}
          style={[styles.sortBtn, sort === "popular" && styles.sortBtnActive]}
        >
          <Text
            style={[
              styles.sortText,
              sort === "popular" && styles.sortTextActive,
            ]}
          >
            Most liked
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={visibleReviews}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isOwn = user?.id === item.userId;
            return (
              <View style={styles.reviewWrapper}>
                <ReviewItem
                  review={item}
                  author={data?.reviewAuthors.get(item.userId) ?? null}
                  isOwn={isOwn}
                  isLiked={data?.likedIds.has(item.id) ?? false}
                  likeBusy={likeBusy.has(item.id)}
                  onToggleLike={handleToggleLike}
                  onEdit={(r) =>
                    router.push({
                      pathname: "/restaurant/[id]/review",
                      params: { id: r.restaurantId, reviewId: r.id },
                    })
                  }
                  onDelete={handleDeleteReview}
                  onAuthorPress={(userId) => router.push(`/profile/${userId}`)}
                  onOpen={(r) => router.push(`/review/${r.id}`)}
                  ownerReply={responses.get(item.id) ?? null}
                />
                {/* Dots menu only on other people's reviews — own reviews use
                    the inline Edit/Delete in the row header, which would
                    otherwise overlap this button. */}
                {!isOwn ? (
                  <Pressable
                    style={styles.moreBtn}
                    onPress={() => setReviewToManage(item)}
                    hitSlop={8}
                  >
                    <MaterialCommunityIcons
                      name="dots-vertical"
                      size={20}
                      color={colors.textMuted}
                    />
                  </Pressable>
                ) : null}
              </View>
            );
          }}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No reviews yet.</Text>
            </View>
          }
        />
      )}

      {/* Review options bottom sheet */}
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

            {/* Only reachable for other people's reviews — own reviews are
                edited/deleted via the inline buttons in the row, never here. */}
            <Pressable
              style={sheetStyles.item}
              onPress={() => {
                const r = reviewToManage;
                setReviewToManage(null);
                Alert.alert("Report Review", "Report this as inappropriate?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Report",
                    style: "destructive",
                    onPress: () => r && handleReportReview(r),
                  },
                ]);
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

            <Pressable
              style={sheetStyles.item}
              onPress={() => {
                const r = reviewToManage;
                const uname = manageAuthor?.username;
                setReviewToManage(null);
                Alert.alert(
                  "Block user",
                  uname
                    ? `Block @${uname}? You won't see each other's reviews or comments.`
                    : "Block this user? You won't see each other's reviews or comments.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Block",
                      style: "destructive",
                      onPress: () => r && handleBlockUser(r),
                    },
                  ],
                );
              }}
            >
              <MaterialCommunityIcons
                name="account-cancel-outline"
                size={22}
                color={colors.textPrimary}
              />
              <Text style={sheetStyles.itemText}>
                {manageAuthor?.username
                  ? `Block @${manageAuthor.username}`
                  : "Block user"}
              </Text>
            </Pressable>

            <Pressable
              style={sheetStyles.cancelBtn}
              onPress={() => setReviewToManage(null)}
            >
              <Text style={sheetStyles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// Rating histogram shown at the top of the reviews list — a big average on
// the left, a 5→1 bar breakdown on the right. Summarizes ALL ratings for the
// restaurant (not just the loaded page), so it's fed by a separate
// distribution fetch rather than the paginated reviews.
const STAR_ROWS: RatingValue[] = [5, 4, 3, 2, 1];

function RatingSummary({ dist }: { dist: RatingDistribution }) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <View style={styles.summary}>
      <View style={styles.summaryLeft}>
        <Text style={styles.avgNumber}>{dist.average.toFixed(1)}</Text>
        <StarRating value={dist.average} size={15} color={colors.star} />
        <Text style={styles.summaryCount}>
          {dist.count} {dist.count === 1 ? "review" : "reviews"}
        </Text>
      </View>
      <View style={styles.summaryBars}>
        {STAR_ROWS.map((star) => {
          const c = dist.buckets[star];
          const pct = dist.count > 0 ? c / dist.count : 0;
          return (
            <View key={star} style={styles.barRow}>
              <Text style={styles.barStar}>{star}</Text>
              <MaterialCommunityIcons
                name="star"
                size={11}
                color={colors.star}
              />
              <View style={styles.barTrack}>
                <View
                  style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]}
                />
              </View>
              <Text style={styles.barCount}>{c}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.lg,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLeft: {
    alignItems: "center",
    justifyContent: "center",
    paddingRight: spacing.lg,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    gap: spacing.xs,
    minWidth: 96,
  },
  avgNumber: {
    fontFamily: fonts.black,
    fontSize: T.size.xxxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  summaryCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  summaryBars: {
    flex: 1,
    gap: spacing.xs,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  barStar: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textSecondary,
    width: 10,
    textAlign: "center",
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.star,
  },
  barCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    minWidth: 24,
    textAlign: "right",
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
  sortRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sortBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortText: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  sortTextActive: {
    color: colors.textInverse,
    fontFamily: fonts.bold,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
  },
  list: { paddingTop: spacing.md, paddingBottom: 100 },
  reviewWrapper: { position: "relative" },
  moreBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.screen + spacing.sm,
    zIndex: 1,
  },
  footerLoader: { paddingVertical: spacing.lg },
  });
}

function makeSheetStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  cancelText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  });
}
