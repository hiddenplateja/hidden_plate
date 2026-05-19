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
import { useAuth } from "@/hooks/useAuth";
import { reportReview } from "@/services/reports";
import {
    getLikedReviewIds,
    likeReview,
    unlikeReview,
} from "@/services/reviewLikes";
import { deleteReview, listReviewsForRestaurant } from "@/services/reviews";
import { getUsersByIds } from "@/services/users";
import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
import type { Review } from "@/types/review";
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

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<SortMode>("recent");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [likeBusy, setLikeBusy] = useState<Set<string>>(new Set());
  const [reviewToManage, setReviewToManage] = useState<Review | null>(null);

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

  const visibleReviews =
    data?.reviews.filter((r) => !hiddenIds.has(r.id)) ?? [];

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
          renderItem={({ item }) => (
            <View style={styles.reviewWrapper}>
              <ReviewItem
                review={item}
                author={data?.reviewAuthors.get(item.userId) ?? null}
                isOwn={user?.id === item.userId}
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
              />
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
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
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

            {reviewToManage?.userId === user?.id ? (
              <>
                <Pressable
                  style={sheetStyles.item}
                  onPress={() => {
                    const r = reviewToManage;
                    setReviewToManage(null);
                    if (r) {
                      router.push({
                        pathname: "/restaurant/[id]/review",
                        params: { id: r.restaurantId, reviewId: r.id },
                      });
                    }
                  }}
                >
                  <MaterialCommunityIcons
                    name="pencil-outline"
                    size={22}
                    color={colors.textPrimary}
                  />
                  <Text style={sheetStyles.itemText}>Edit Review</Text>
                </Pressable>
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
              </>
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
    </SafeAreaView>
  );
}

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
    borderBottomColor: colors.divider,
  },
  sortBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
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
