// app/restaurant/[id]/index.tsx
// Restaurant detail screen — ported from old design.
//
// Design: gray page bg, white card blocks, Roboto fonts, coral primary.
// Sections: cover image + save buttons, info card, food photos,
//           reviews preview (3) + see all, write review CTA.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReviewItem } from "@/components/ReviewItem";
import { useAuth } from "@/hooks/useAuth";
import { reportReview } from "@/services/reports";
import { getRestaurantById } from "@/services/restaurants";
import {
  getLikedReviewIds,
  likeReview,
  unlikeReview,
} from "@/services/reviewLikes";
import {
  deleteReview,
  getMyReviewForRestaurant,
  getRestaurantReviewStats,
  listReviewsForRestaurant,
} from "@/services/reviews";
import { getSavedStatus, toggleSaved, type ListType } from "@/services/saved";
import { getImagePreviewUrl, getImageViewUrl } from "@/services/storage";
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

const { width: SW } = Dimensions.get("window");
const REVIEWS_PREVIEW = 3;

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

interface ScreenData {
  restaurant: Restaurant;
  reviews: Review[];
  reviewAuthors: Map<string, User>;
  likedIds: Set<string>;
  myReview: Review | null;
  savedStatus: Record<ListType, string | null>;
  stats: { count: number; average: number };
}

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ScreenData };

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [likeBusy, setLikeBusy] = useState<Set<string>>(new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const [hiddenReviewIds, setHiddenReviewIds] = useState<Set<string>>(
    new Set(),
  );
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const [reviewToManage, setReviewToManage] = useState<Review | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setState({ status: "error", message: "No restaurant id." });
      return;
    }
    setState({ status: "loading" });
    try {
      const [restaurant, reviewsPage, myReview, stats, savedStatus] =
        await Promise.all([
          getRestaurantById(id),
          listReviewsForRestaurant(id, { pageSize: REVIEWS_PREVIEW }),
          getMyReviewForRestaurant(id),
          getRestaurantReviewStats(id),
          getSavedStatus(id),
        ]);

      restaurant.reviewCount = stats.count;
      restaurant.averageRating = stats.average;

      const authorIds = reviewsPage.items.map((r) => r.userId);
      const [reviewAuthors, likedIds] = await Promise.all([
        getUsersByIds(authorIds),
        getLikedReviewIds(reviewsPage.items.map((r) => r.id)),
      ]);

      setState({
        status: "ready",
        data: {
          restaurant,
          reviews: reviewsPage.items,
          reviewAuthors,
          likedIds,
          myReview,
          savedStatus,
          stats,
        },
      });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Couldn't load.",
      });
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleToggleSaved = useCallback(
    async (listType: ListType) => {
      if (state.status !== "ready" || saveBusy) return;
      setSaveBusy(true);
      try {
        const next = await toggleSaved(
          state.data.restaurant.id,
          listType,
          state.data.savedStatus,
        );
        setState((prev) => {
          if (prev.status !== "ready") return prev;
          return {
            ...prev,
            data: { ...prev.data, savedStatus: next },
          };
        });
      } catch (err) {
        Alert.alert(
          "Couldn't save",
          err instanceof Error ? err.message : "Try again.",
        );
      } finally {
        setSaveBusy(false);
      }
    },
    [state, saveBusy],
  );

  const handleToggleLike = useCallback(
    async (reviewId: string, currentlyLiked: boolean) => {
      if (state.status !== "ready") return;
      setLikeBusy((p) => new Set(p).add(reviewId));
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const nextLiked = new Set(prev.data.likedIds);
        if (currentlyLiked) nextLiked.delete(reviewId);
        else nextLiked.add(reviewId);
        const nextReviews = prev.data.reviews.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                likeCount: Math.max(0, r.likeCount + (currentlyLiked ? -1 : 1)),
              }
            : r,
        );
        return {
          ...prev,
          data: { ...prev.data, reviews: nextReviews, likedIds: nextLiked },
        };
      });
      try {
        if (currentlyLiked) await unlikeReview(reviewId);
        else await likeReview(reviewId, state.data.restaurant.id);
      } catch (err) {
        Alert.alert(
          "Couldn't update like",
          err instanceof Error ? err.message : "Try again.",
        );
        // Revert
        setState((prev) => {
          if (prev.status !== "ready") return prev;
          const nextLiked = new Set(prev.data.likedIds);
          if (currentlyLiked) nextLiked.add(reviewId);
          else nextLiked.delete(reviewId);
          const nextReviews = prev.data.reviews.map((r) =>
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
          return {
            ...prev,
            data: { ...prev.data, reviews: nextReviews, likedIds: nextLiked },
          };
        });
      } finally {
        setLikeBusy((p) => {
          const n = new Set(p);
          n.delete(reviewId);
          return n;
        });
      }
    },
    [state],
  );

  const handleDeleteReview = useCallback(
    async (review: Review) => {
      try {
        await deleteReview(review.id);
        load();
      } catch (err) {
        Alert.alert(
          "Couldn't delete",
          err instanceof Error ? err.message : "Try again.",
        );
      }
    },
    [load],
  );

  const handleReportReview = useCallback(async (review: Review) => {
    setHiddenReviewIds((p) => new Set(p).add(review.id));
    setReviewToManage(null);
    try {
      await reportReview(review.id, review.restaurantId, "inappropriate");
      Alert.alert("Reported", "Thank you for keeping our community safe.");
    } catch (err) {
      Alert.alert(
        "Couldn't report",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (state.status !== "ready") return;
    try {
      await Share.share({
        message: `Check out ${state.data.restaurant.name} on Hidden Plate JA!`,
      });
    } catch {}
  }, [state]);

  const handleCall = useCallback(() => {
    if (state.status !== "ready") return;
    const phone = state.data.restaurant.phoneNumber;
    if (!phone) {
      Alert.alert("Not available", "No phone number listed.");
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() =>
      Alert.alert("Error", "Could not open the phone dialer."),
    );
  }, [state]);

  const handleDirections = useCallback(() => {
    if (state.status !== "ready") return;
    const { latitude: lat, longitude: lng, name } = state.data.restaurant;
    const url = Platform.select({
      ios: `maps://0,0?q=${encodeURIComponent(name)}@${lat},${lng}`,
      default: `geo:0,0?q=${lat},${lng}(${encodeURIComponent(name)})`,
    });
    Linking.openURL(url).catch(() =>
      Alert.alert("Error", "Could not open maps."),
    );
  }, [state]);

  const handleWebsite = useCallback(() => {
    if (state.status !== "ready") return;
    const url = state.data.restaurant.websiteUrl;
    if (!url) {
      Alert.alert("Not available", "No website listed.");
      return;
    }
    const full = url.startsWith("http") ? url : `https://${url}`;
    Linking.openURL(full).catch(() =>
      Alert.alert("Error", "Could not open link."),
    );
  }, [state]);

  if (state.status === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <SafeAreaView style={styles.errorContainer} edges={["top"]}>
        <Text style={styles.errorTitle}>Couldn't load</Text>
        <Text style={styles.errorMessage}>{state.message}</Text>
        <Pressable onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const {
    restaurant,
    reviews,
    reviewAuthors,
    likedIds,
    myReview,
    savedStatus,
    stats,
  } = state.data;

  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const heroUrl = coverId ? getImagePreviewUrl(coverId) : null;
  const parishText = PARISH_LABELS[restaurant.parish] ?? restaurant.parish;

  // Aggregate all review photos for the "Food Photos" section
  const allPhotoFileIds = reviews.flatMap((r) => r.imageIds);

  const visibleReviews = reviews.filter((r) => !hiddenReviewIds.has(r.id));

  // ── List header (everything above the reviews) ───────────────────────────

  const renderHeader = () => (
    <View>
      {/* ── Cover image ── */}
      <View style={headerStyles.imageWrap}>
        {heroUrl ? (
          <Image
            source={{ uri: heroUrl }}
            style={headerStyles.coverImage}
            contentFit="cover"
            transition={250}
            cachePolicy="memory-disk"
          />
        ) : (
          <View
            style={[headerStyles.coverImage, headerStyles.coverPlaceholder]}
          >
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={40}
              color={colors.border}
            />
          </View>
        )}

        {/* Back + Share overlay */}
        <SafeAreaView style={headerStyles.topBar} edges={["top"]}>
          <Pressable
            style={headerStyles.circleBtn}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>
          <Pressable
            style={headerStyles.circleBtn}
            onPress={handleShare}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name="share-variant"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>
        </SafeAreaView>

        {/* Save buttons — bottom-right of image */}
        <View style={headerStyles.saveRow}>
          <SaveButton
            icon="heart-outline"
            activeIcon="heart"
            isActive={!!savedStatus.favorite}
            label="Favorite"
            onPress={() => handleToggleSaved("favorite")}
            disabled={saveBusy}
          />
          <SaveButton
            icon="bookmark-outline"
            activeIcon="bookmark"
            isActive={!!savedStatus.want_to_go}
            label="Want to go"
            onPress={() => handleToggleSaved("want_to_go")}
            disabled={saveBusy}
          />
          <SaveButton
            icon="check-circle-outline"
            activeIcon="check-circle"
            isActive={!!savedStatus.visited}
            label="Visited"
            onPress={() => handleToggleSaved("visited")}
            disabled={saveBusy}
          />
        </View>
      </View>

      {/* ── Info card ── */}
      <View style={headerStyles.infoCard}>
        {/* Name + rating */}
        <View style={headerStyles.nameRow}>
          <Text style={headerStyles.name} numberOfLines={2}>
            {restaurant.name}
          </Text>
          {stats.count > 0 ? (
            <View style={headerStyles.ratingBadge}>
              <MaterialCommunityIcons
                name="star"
                size={16}
                color={colors.star}
              />
              <Text style={headerStyles.ratingValue}>
                {stats.average.toFixed(1)}
              </Text>
              <Text style={headerStyles.ratingCount}>({stats.count})</Text>
            </View>
          ) : null}
        </View>

        {/* Cuisine + category chips */}
        {restaurant.cuisines.length > 0 || restaurant.categories.length > 0 ? (
          <View style={headerStyles.chipsRow}>
            {restaurant.cuisines.map((c) => (
              <View
                key={`cui-${c}`}
                style={[headerStyles.chip, headerStyles.chipPrimary]}
              >
                <Text style={headerStyles.chipPrimaryText}>{c}</Text>
              </View>
            ))}
            {restaurant.categories.map((c) => (
              <View key={`cat-${c}`} style={headerStyles.chip}>
                <Text style={headerStyles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Description */}
        {restaurant.description ? (
          <Text style={headerStyles.description}>{restaurant.description}</Text>
        ) : null}

        {/* Address + hours */}
        {restaurant.address || restaurant.openingHours ? (
          <View style={headerStyles.metaBlock}>
            {restaurant.address ? (
              <View style={headerStyles.metaRow}>
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={headerStyles.metaText}>
                  {restaurant.address}
                  {restaurant.city
                    ? `, ${restaurant.city}, ${parishText}`
                    : `, ${parishText}`}
                </Text>
              </View>
            ) : null}
            {restaurant.openingHours ? (
              <View style={headerStyles.metaRow}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={headerStyles.metaText}>See hours below</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Action pills */}
        <View style={headerStyles.pillsRow}>
          <ActionPill
            icon="directions"
            label="Map"
            onPress={handleDirections}
          />
          <ActionPill
            icon="phone"
            label="Call"
            onPress={handleCall}
            disabled={!restaurant.phoneNumber}
          />
          <ActionPill
            icon="web"
            label="Website"
            onPress={handleWebsite}
            disabled={!restaurant.websiteUrl}
          />
        </View>

        {/* Write / Edit review CTA */}
        <Pressable
          style={headerStyles.reviewCta}
          onPress={() => {
            if (myReview) {
              router.push({
                pathname: "/restaurant/[id]/review",
                params: { id: restaurant.id, reviewId: myReview.id },
              });
            } else {
              router.push({
                pathname: "/restaurant/[id]/review",
                params: { id: restaurant.id },
              });
            }
          }}
        >
          <MaterialCommunityIcons
            name="camera-plus"
            size={20}
            color={colors.textInverse}
          />
          <Text style={headerStyles.reviewCtaText}>
            {myReview ? "Edit Your Review" : "Add Review & Photo"}
          </Text>
        </Pressable>
      </View>

      {/* ── Community food photos ── */}
      {allPhotoFileIds.length > 0 ? (
        <View style={headerStyles.photosBlock}>
          <Text style={headerStyles.sectionTitle}>Food Photos</Text>
          <FlatList
            horizontal
            data={allPhotoFileIds}
            keyExtractor={(fileId, i) => `photo-${fileId}-${i}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={headerStyles.photosContent}
            renderItem={({ item: fileId, index }) => (
              <Pressable onPress={() => setActivePhotoIndex(index)}>
                <Image
                  source={{ uri: getImageViewUrl(fileId) }}
                  style={headerStyles.photoThumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              </Pressable>
            )}
          />
        </View>
      ) : null}

      {/* ── Reviews section header ── */}
      <View style={headerStyles.reviewsHeader}>
        <Text style={headerStyles.sectionTitle}>Recent Reviews</Text>
        <View style={headerStyles.reviewsHeaderRight}>
          <Text style={headerStyles.reviewsCount}>
            {stats.count} {stats.count === 1 ? "review" : "reviews"}
          </Text>
          {stats.count > REVIEWS_PREVIEW ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/restaurant/[id]/reviews",
                  params: { id: restaurant.id },
                })
              }
              hitSlop={8}
            >
              <Text style={headerStyles.seeAll}>See all</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={visibleReviews}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.reviewWrapper}>
            <ReviewItem
              review={item}
              author={reviewAuthors.get(item.userId) ?? null}
              isOwn={user?.id === item.userId}
              isLiked={likedIds.has(item.id)}
              likeBusy={likeBusy.has(item.id)}
              onToggleLike={handleToggleLike}
              onEdit={(r) =>
                router.push({
                  pathname: "/restaurant/[id]/review",
                  params: { id: r.restaurantId, reviewId: r.id },
                })
              }
              onDelete={handleDeleteReview}
              onPhotoTap={(imageIds, startIndex) => {
                const offset = allPhotoFileIds.indexOf(imageIds[0]);
                setActivePhotoIndex(
                  offset >= 0 ? offset + startIndex : startIndex,
                );
              }}
              onAuthorPress={(userId) => router.push(`/profile/${userId}`)}
            />
            {/* Review options menu trigger */}
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
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons
                name="comment-text-outline"
                size={32}
                color={colors.primary}
              />
            </View>
            <Text style={styles.emptyTitle}>No reviews yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to review {restaurant.name}!
            </Text>
          </View>
        }
      />

      {/* ── Review options bottom sheet ── */}
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
                    setReviewToManage(null);
                    if (reviewToManage) {
                      router.push({
                        pathname: "/restaurant/[id]/review",
                        params: {
                          id: reviewToManage.restaurantId,
                          reviewId: reviewToManage.id,
                        },
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
                    "Report this review as inappropriate?",
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

      {/* ── Full-screen photo viewer ── */}
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
              data={allPhotoFileIds}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SaveButtonProps {
  icon: string;
  activeIcon: string;
  isActive: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function SaveButton({
  icon,
  activeIcon,
  isActive,
  onPress,
  disabled,
}: SaveButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[saveStyles.btn, isActive && saveStyles.btnActive]}
      accessibilityRole="button"
    >
      <MaterialCommunityIcons
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={(isActive ? activeIcon : icon) as any}
        size={22}
        color={isActive ? colors.primary : colors.textSecondary}
      />
    </Pressable>
  );
}

interface ActionPillProps {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function ActionPill({ icon, label, onPress, disabled }: ActionPillProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[pillStyles.pill, disabled && pillStyles.pillDisabled]}
      accessibilityRole="button"
    >
      <MaterialCommunityIcons
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={icon as any}
        size={18}
        color={disabled ? colors.textMuted : colors.primary}
      />
      <Text style={[pillStyles.label, disabled && pillStyles.labelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.pageBackground },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  errorMessage: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  backBtn: { paddingVertical: spacing.md },
  backBtnText: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  listContent: { paddingBottom: 100 },
  reviewWrapper: { position: "relative" },
  moreBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.screen + spacing.sm,
    zIndex: 1,
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
  },
  emptySubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: "center",
  },
});

const headerStyles = StyleSheet.create({
  imageWrap: { position: "relative", height: 300 },
  coverImage: { width: "100%", height: "100%" },
  coverPlaceholder: {
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
  },
  saveRow: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.screen,
    flexDirection: "row",
    gap: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.cardBackground,
    padding: spacing.xl,
    marginBottom: spacing.sm,
  },
  nameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  name: {
    flex: 1,
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ratingValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  ratingCount: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    backgroundColor: colors.pageBackground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipPrimary: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryLight,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  chipPrimaryText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
    textTransform: "capitalize",
  },
  description: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  metaBlock: {
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  metaText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  pillsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  reviewCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  reviewCtaText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  photosBlock: {
    backgroundColor: colors.cardBackground,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    paddingHorizontal: spacing.screen,
    marginBottom: spacing.md,
  },
  photosContent: {
    paddingHorizontal: spacing.screen,
    gap: spacing.md,
  },
  photoThumb: {
    width: 110,
    height: 110,
    borderRadius: radius.lg,
    backgroundColor: colors.pageBackground,
  },
  reviewsHeader: {
    backgroundColor: colors.cardBackground,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  reviewsHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  reviewsCount: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  seeAll: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
});

const saveStyles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
  },
  btnActive: { backgroundColor: colors.primaryLight },
});

const pillStyles = StyleSheet.create({
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.cardBackground,
  },
  pillDisabled: {
    borderColor: colors.divider,
    backgroundColor: colors.pageBackground,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  labelDisabled: { color: colors.textMuted },
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
