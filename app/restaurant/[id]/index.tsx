// app/restaurant/[id]/index.tsx
// Restaurant detail screen — ported from old design.
//
// Design: white page, hairline-divided sections, surface-filled sub-blocks,
//         a hero-overlap info card, Roboto fonts, coral primary.
// Sections: cover image + save buttons, info card, food photos,
//           reviews preview (3) + see all, write review CTA.
//
// Interaction notes:
//   - Save buttons (Favorite / Want to Go / Visited) show a confirmation
//     bottom sheet only when ADDING. Removing is instant (tap-to-undo
//     should be friction-free; the user is usually correcting a mistake).
//     Want-to-Go and Visited are mutually exclusive, so when adding one
//     that would displace the other, the confirmation mentions it.
//   - The dots menu on review rows is shown ONLY for other users' reviews,
//     since the row itself exposes inline Edit/Delete buttons for the
//     author. This avoids the overlap the inline buttons had with an
//     always-on dots button. The menu's only action for non-author cases
//     is "Report as Inappropriate".
//
// Failure handling:
//   - Primary fetch (the restaurant itself) failing → full-screen ErrorState
//     with retry. Without the restaurant, there's nothing to render.
//   - Secondary fetches (reviews, stats, save status, my-review) failing
//     → the screen still renders with the restaurant info; affected sections
//     degrade quietly (empty reviews, 0 ratings, "not saved" defaults).
//     This trades completeness for resilience — a flaky reviews query
//     shouldn't black-hole the restaurant page.
//   - All failures report to Sentry regardless.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as ExpoLinking from "expo-linking";
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AddToListSheet } from "@/components/AddToListSheet";
import { ErrorState } from "@/components/ErrorState";
import { MenuSheet } from "@/components/MenuSheet";
import { RestaurantOwnerCallout } from "@/components/RestaurantOwnerCallout";
import { ReviewItem } from "@/components/ReviewItem";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import {
  useRestaurantDetail,
  type RestaurantDetailData,
} from "@/hooks/useRestaurantDetail";
import { queryClient } from "@/lib/queryClient";
import { blockUser, getHiddenUserIds } from "@/services/blocks";
import { listsEnabled } from "@/services/lists";
import { reportReview } from "@/services/reports";
import { getOwnerMenu } from "@/services/restaurantMenus";
import { recordRestaurantView } from "@/services/restaurantViews";
import { likeReview, unlikeReview } from "@/services/reviewLikes";
import { deleteReview } from "@/services/reviews";
import { toggleSaved, type ListType } from "@/services/saved";
import { captureError } from "@/services/sentry";
import { getImagePreviewUrl, getImageViewUrl } from "@/services/storage";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type {
  DayHours,
  MenuSection,
  OpeningHours,
  Parish,
} from "@/types/restaurant";
import type { Review } from "@/types/review";
import { formatTime, getOpenStatus as computeOpenStatus } from "@/utils/openStatus";

const { width: SW } = Dimensions.get("window");

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

const HERO_HEIGHT = Math.min(Math.round(SW * 1.05), 440);

// Days indexed to match Date.getDay() (0 = Sunday).
const DAY_KEYS: (keyof OpeningHours)[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

// Open/closed status — delegates to the shared util (which handles split
// shifts, overnight hours, and next-day lookahead) and maps to the
// {open, text} shape this screen's hero + hours rows already consume.
function getOpenStatus(
  hours: OpeningHours | null,
): { open: boolean; text: string } | null {
  const s = computeOpenStatus(hours);
  return s.state === "unknown"
    ? null
    : { open: s.state === "open", text: s.label ?? "" };
}

function formatDayHours(slots: DayHours[] | undefined): string {
  if (!slots || slots.length === 0) return "Closed";
  return slots
    .map((s) => `${formatTime(s.open)} – ${formatTime(s.close)}`)
    .join(", ");
}

// Display config per list-type — used by both the save buttons and the
// confirmation sheet, so the icons + copy stay in sync.
const LIST_TYPE_CONFIG: Record<
  ListType,
  {
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    addTitle: string;
    addBody: string;
    confirmLabel: string;
  }
> = {
  favorite: {
    label: "Favorites",
    icon: "heart",
    addTitle: "Add to Favorites?",
    addBody: "Save this spot to your favorites for quick access.",
    confirmLabel: "Add to Favorites",
  },
  want_to_go: {
    label: "Want to Go",
    icon: "bookmark",
    addTitle: "Add to Want to Go?",
    addBody: "Save this spot to try later.",
    confirmLabel: "Add to Want to Go",
  },
  visited: {
    label: "Visited",
    icon: "check-circle",
    addTitle: "Mark as Visited?",
    addBody: "Keep track of where you've eaten.",
    confirmLabel: "Mark as Visited",
  },
};

// Reviews shown on the detail screen before the "See all" link appears.
const REVIEWS_PREVIEW = 3;

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  // Detail data via React Query (src/hooks/useRestaurantDetail.ts): in-memory
  // cached for instant back-navigation + dedup; mutations patch the cache.
  const detailQuery = useRestaurantDetail(id);
  const { refetch: refetchDetail } = detailQuery;
  const data = detailQuery.data;

  // Apply an optimistic mutation to the cached detail data (likes / saves).
  const patchDetail = useCallback(
    (updater: (d: RestaurantDetailData) => RestaurantDetailData) => {
      queryClient.setQueryData<RestaurantDetailData>(
        ["restaurant-detail", id],
        (prev) => (prev ? updater(prev) : prev),
      );
    },
    [id],
  );
  const [likeBusy, setLikeBusy] = useState<Set<string>>(new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const [hiddenReviewIds, setHiddenReviewIds] = useState<Set<string>>(
    new Set(),
  );
  // Mutual block set (people I blocked + people who blocked me). Their
  // reviews/photos are filtered out below. Tolerant — empty on failure.
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const [reviewToManage, setReviewToManage] = useState<Review | null>(null);
  // Pending save action awaiting confirmation. null = sheet closed.
  const [pendingSave, setPendingSave] = useState<ListType | null>(null);
  // "Add to a collection" sheet visibility.
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Owner-edited menu override (null = none → fall back to restaurant.menu).
  const [ownerMenu, setOwnerMenu] = useState<MenuSection[] | null>(null);
  const { styles, colors } = useThemedStyles(makeStyles);
  const hs = useThemedStyles(makeHsStyles).styles;
  const stickyStyles = useThemedStyles(makeStickyStyles).styles;
  const sheetStyles = useThemedStyles(makeSheetStyles).styles;
  const confirmStyles = useThemedStyles(makeConfirmStyles).styles;


  useFocusEffect(
    useCallback(() => {
      refetchDetail();
      getHiddenUserIds().then(setBlockedUserIds);
      // Owner-edited menu override; refreshed on focus (e.g. after editing it).
      if (id) getOwnerMenu(id).then(setOwnerMenu);
      // Record this view (once per user) for analytics. Counts are NOT shown
      // in-app — they're for the owner to read in the Appwrite console. Runs
      // off the critical path and is idempotent per viewer, so re-focus is cheap.
      if (id) {
        recordRestaurantView(id).catch(() => {});
      }
    }, [refetchDetail, id]),
  );

  // The actual save toggle — no UI surface here, just the data call. The
  // two entry points (tap-to-remove, confirm-to-add) both call this.
  const performSaveToggle = useCallback(
    async (listType: ListType) => {
      if (!data || saveBusy) return;
      setSaveBusy(true);
      try {
        const next = await toggleSaved(
          data.restaurant.id,
          listType,
          data.savedStatus,
        );
        patchDetail((d) => ({ ...d, savedStatus: next }));
      } catch (err) {
        captureError(err, {
          screen: "restaurantDetail",
          op: "toggleSaved",
          listType,
          restaurantId: data.restaurant.id,
        });
        Alert.alert(
          "Couldn't save",
          err instanceof Error ? err.message : "Try again.",
        );
      } finally {
        setSaveBusy(false);
      }
    },
    [data, saveBusy, patchDetail],
  );

  // Tap on a save button → either immediately remove (if currently saved)
  // or open the confirmation sheet (if currently unsaved).
  const handleSavePress = useCallback(
    (listType: ListType) => {
      if (!data || saveBusy) return;
      const isCurrentlySaved = !!data.savedStatus[listType];
      if (isCurrentlySaved) {
        // Remove is instant — no confirmation needed.
        performSaveToggle(listType);
      } else {
        // Add — show confirmation sheet.
        setPendingSave(listType);
      }
    },
    [data, saveBusy, performSaveToggle],
  );

  const handleConfirmSave = useCallback(() => {
    if (!pendingSave) return;
    const listType = pendingSave;
    setPendingSave(null);
    performSaveToggle(listType);
  }, [pendingSave, performSaveToggle]);

  const handleToggleLike = useCallback(
    async (reviewId: string, currentlyLiked: boolean) => {
      if (!data) return;
      setLikeBusy((p) => new Set(p).add(reviewId));
      patchDetail((d) => {
        const nextLiked = new Set(d.likedIds);
        if (currentlyLiked) nextLiked.delete(reviewId);
        else nextLiked.add(reviewId);
        const nextReviews = d.reviews.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                likeCount: Math.max(0, r.likeCount + (currentlyLiked ? -1 : 1)),
              }
            : r,
        );
        return { ...d, reviews: nextReviews, likedIds: nextLiked };
      });
      try {
        if (currentlyLiked) await unlikeReview(reviewId);
        else await likeReview(reviewId, data.restaurant.id);
      } catch (err) {
        captureError(err, {
          screen: "restaurantDetail",
          op: "toggleLike",
          reviewId,
        });
        Alert.alert(
          "Couldn't update like",
          err instanceof Error ? err.message : "Try again.",
        );
        // Revert
        patchDetail((d) => {
          const nextLiked = new Set(d.likedIds);
          if (currentlyLiked) nextLiked.add(reviewId);
          else nextLiked.delete(reviewId);
          const nextReviews = d.reviews.map((r) =>
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
          return { ...d, reviews: nextReviews, likedIds: nextLiked };
        });
      } finally {
        setLikeBusy((p) => {
          const n = new Set(p);
          n.delete(reviewId);
          return n;
        });
      }
    },
    [data, patchDetail],
  );

  const handleDeleteReview = useCallback(
    async (review: Review) => {
      try {
        await deleteReview(review.id);
        refetchDetail();
      } catch (err) {
        captureError(err, {
          screen: "restaurantDetail",
          op: "deleteReview",
          reviewId: review.id,
        });
        Alert.alert(
          "Couldn't delete",
          err instanceof Error ? err.message : "Try again.",
        );
      }
    },
    [refetchDetail],
  );

  const handleReportReview = useCallback(async (review: Review) => {
    setHiddenReviewIds((p) => new Set(p).add(review.id));
    setReviewToManage(null);
    try {
      await reportReview(review.id, review.restaurantId, "inappropriate");
      Alert.alert("Reported", "Thank you for keeping our community safe.");
    } catch (err) {
      // Roll back the optimistic hide so the user can see the report didn't
      // go through. Same pattern as Community feed.
      setHiddenReviewIds((p) => {
        const next = new Set(p);
        next.delete(review.id);
        return next;
      });
      captureError(err, {
        screen: "restaurantDetail",
        op: "reportReview",
        reviewId: review.id,
      });
      Alert.alert(
        "Couldn't report",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  // Block the author of a review. Optimistic: add to blockedUserIds so their
  // reviews/photos vanish immediately; revert on error. The block persists via
  // the blocks service and the mutual hide refreshes on next focus.
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
        screen: "restaurantDetail",
        op: "blockUser",
        targetUserId: targetId,
      });
      Alert.alert(
        "Couldn't block",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!data) return;
    const { name } = data.restaurant;
    // Deep link into this restaurant (scheme "hiddenplate") — opens the app for
    // anyone who has it installed.
    const url = ExpoLinking.createURL(`/restaurant/${data.restaurant.id}`);
    try {
      await Share.share({
        message: `Check out ${name} on Hidden Plate JA — ${url}`,
        url, // iOS attaches this separately; Android folds it into the message
        title: name,
      });
    } catch {
      // Share sheet dismissal isn't an error — keep silent.
    }
  }, [data]);

  const handleCall = useCallback(() => {
    if (!data) return;
    const phone = data.restaurant.phoneNumber;
    if (!phone) {
      Alert.alert("Not available", "No phone number listed.");
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() =>
      Alert.alert("Error", "Could not open the phone dialer."),
    );
  }, [data]);

  const handleDirections = useCallback(() => {
    if (!data) return;
    const { latitude: lat, longitude: lng, name } = data.restaurant;
    const url = Platform.select({
      ios: `maps://0,0?q=${encodeURIComponent(name)}@${lat},${lng}`,
      default: `geo:0,0?q=${lat},${lng}(${encodeURIComponent(name)})`,
    });
    Linking.openURL(url).catch(() =>
      Alert.alert("Error", "Could not open maps."),
    );
  }, [data]);

  const handleWebsite = useCallback(() => {
    if (!data) return;
    const url = data.restaurant.websiteUrl;
    if (!url) {
      Alert.alert("Not available", "No website listed.");
      return;
    }
    const full = url.startsWith("http") ? url : `https://${url}`;
    Linking.openURL(full).catch(() =>
      Alert.alert("Error", "Could not open link."),
    );
  }, [data]);

  // Open the full reviews list. Used by the "See all" link AND the tappable
  // rating badge / review-count text, so any review-count affordance routes
  // to the same place.
  const handleOpenAllReviews = useCallback(() => {
    if (!data) return;
    router.push({
      pathname: "/restaurant/[id]/reviews",
      params: { id: data.restaurant.id },
    });
  }, [data, router]);

  // Write a new review or edit the user's existing one. Used by the sticky bar.
  const handleWriteReview = useCallback(() => {
    if (!data) return;
    const { restaurant, myReview } = data;
    router.push({
      pathname: "/restaurant/[id]/review",
      params: myReview
        ? { id: restaurant.id, reviewId: myReview.id }
        : { id: restaurant.id },
    });
  }, [data, router]);

  if (!data) {
    // Error screen when there's nothing to show (failed fetch / bad id);
    // otherwise the loading spinner. Retry re-runs the query.
    if (detailQuery.isError || !id) {
      return (
        <SafeAreaView style={styles.errorWrap} edges={["top"]}>
          <View style={styles.errorBackBar}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={styles.errorBackBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={22}
                color={colors.textPrimary}
              />
            </Pressable>
          </View>
          <ErrorState
            variant="screen"
            icon="silverware-fork-knife"
            title="Couldn't load this restaurant"
            body="Check your connection and try again."
            onRetry={refetchDetail}
          />
        </SafeAreaView>
      );
    }
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const {
    restaurant,
    reviews,
    reviewAuthors,
    ownerResponses,
    likedIds,
    myReview,
    savedStatus,
    stats,
  } = data;

  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const heroUrl = coverId ? getImagePreviewUrl(coverId) : null;
  const parishText = PARISH_LABELS[restaurant.parish] ?? restaurant.parish;

  // Menu shown here: the owner's edited override wins over the admin-managed
  // base menu on the restaurant doc. isOwner gates the "Edit menu" entry.
  const effectiveMenu =
    ownerMenu && ownerMenu.length > 0 ? ownerMenu : restaurant.menu;
  const isOwner = !!user?.id && user.id === restaurant.ownerId;

  // Hide reviews from reported (hiddenReviewIds) AND blocked users — both
  // directions of the block, via getHiddenUserIds().
  const visibleReviews = reviews.filter(
    (r) => !hiddenReviewIds.has(r.id) && !blockedUserIds.has(r.userId),
  );

  // Author of the review currently in the manage sheet — drives the
  // "Block @username" label + confirm copy.
  const manageAuthor = reviewToManage
    ? (reviewAuthors.get(reviewToManage.userId) ?? null)
    : null;

  // Aggregate review photos for the "Food Photos" section — from visible
  // reviews only, so a blocked user's photos don't leak into the grid.
  const allPhotoFileIds = visibleReviews.flatMap((r) => r.imageIds);

  // Compute "this will displace X" copy for the confirmation sheet.
  // Only relevant when adding visited (displaces want_to_go) or vice versa.
  const pendingDisplaces: ListType | null =
    pendingSave === "visited" && savedStatus.want_to_go
      ? "want_to_go"
      : pendingSave === "want_to_go" && savedStatus.visited
        ? "visited"
        : null;

  const openStatus = getOpenStatus(restaurant.openingHours);
  const primaryCuisine = restaurant.cuisines[0] ?? null;
  const todayHours = restaurant.openingHours
    ? restaurant.openingHours[DAY_KEYS[new Date().getDay()]]
    : null;
  const hasTags =
    restaurant.cuisines.length > 0 || restaurant.categories.length > 0;
  const locationText = restaurant.city
    ? `${restaurant.address}, ${restaurant.city}, ${parishText}`
    : `${restaurant.address}, ${parishText}`;

  // ── List header (everything above the reviews) ───────────────────────────

  const renderHeader = () => (
    <View>
      {/* ── Immersive hero ── */}
      <View style={hs.hero}>
        {heroUrl ? (
          <Image
            source={{ uri: heroUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={250}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, hs.heroPlaceholder]}>
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={48}
              color={colors.border}
            />
          </View>
        )}

        <LinearGradient
          colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0)", "rgba(0,0,0,0.85)"]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Floating top buttons */}
        <SafeAreaView style={hs.topBar} edges={["top"]}>
          <FrostBtn icon="arrow-left" onPress={() => router.back()} />
          <View style={hs.topRight}>
            <FrostBtn icon="share-variant" onPress={handleShare} />
            <FrostBtn
              icon={savedStatus.favorite ? "heart" : "heart-outline"}
              active={!!savedStatus.favorite}
              onPress={() => handleSavePress("favorite")}
            />
          </View>
        </SafeAreaView>

        {/* Name + meta overlay */}
        <View style={hs.heroContent}>
          <Text style={hs.heroName} numberOfLines={2}>
            {restaurant.name}
          </Text>
          <View style={hs.heroMetaRow}>
            {stats.count > 0 ? (
              <Pressable
                style={hs.ratingPill}
                onPress={handleOpenAllReviews}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`See all ${stats.count} reviews`}
              >
                <MaterialCommunityIcons
                  name="star"
                  size={14}
                  color={colors.star}
                />
                <Text style={hs.ratingValue}>{stats.average.toFixed(1)}</Text>
                <Text style={hs.ratingCount}>({stats.count})</Text>
              </Pressable>
            ) : (
              <View style={hs.newPill}>
                <Text style={hs.newPillText}>New</Text>
              </View>
            )}
            {restaurant.priceRange ? (
              <>
                <Text style={hs.heroDot}>·</Text>
                <Text style={hs.heroMeta}>{restaurant.priceRange}</Text>
              </>
            ) : null}
            {primaryCuisine ? (
              <>
                <Text style={hs.heroDot}>·</Text>
                <Text style={hs.heroMeta}>{primaryCuisine}</Text>
              </>
            ) : null}
          </View>
          {openStatus ? (
            <View style={hs.openBadge}>
              <View
                style={[
                  hs.openDot,
                  {
                    backgroundColor: openStatus.open
                      ? colors.success
                      : colors.error,
                  },
                ]}
              />
              <Text style={hs.openText}>{openStatus.text}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── Content sheet (overlaps the hero) ── */}
      <View style={hs.sheet}>
        {/* Quick contact actions */}
        <View style={hs.quickRow}>
          <QuickTile
            icon="directions"
            label="Directions"
            onPress={handleDirections}
          />
          <QuickTile
            icon="phone"
            label="Call"
            onPress={handleCall}
            disabled={!restaurant.phoneNumber}
          />
          <QuickTile
            icon="web"
            label="Website"
            onPress={handleWebsite}
            disabled={!restaurant.websiteUrl}
          />
          <QuickTile icon="share-variant" label="Share" onPress={handleShare} />
        </View>

        {/* Own this business? Claim / verified-owner / pending */}
        <RestaurantOwnerCallout
          restaurant={restaurant}
          currentUserId={user?.id ?? null}
          onClaim={() => router.push(`/claim/${restaurant.id}`)}
          onPromote={() => router.push(`/promote/${restaurant.id}`)}
          onManageListing={() => router.push(`/listing/${restaurant.id}`)}
        />

        {/* About */}
        {restaurant.description ? (
          <View style={hs.section}>
            <Text style={hs.h2}>About</Text>
            <Text style={hs.body}>{restaurant.description}</Text>
          </View>
        ) : null}

        {/* Tags */}
        {hasTags ? (
          <View style={hs.section}>
            <Text style={hs.h2}>What they serve</Text>
            <View style={hs.chipsRow}>
              {restaurant.cuisines.map((c) => (
                <View key={`cui-${c}`} style={[hs.chip, hs.chipPrimary]}>
                  <Text style={hs.chipPrimaryText}>{c}</Text>
                </View>
              ))}
              {restaurant.categories.map((c) => (
                <View key={`cat-${c}`} style={hs.chip}>
                  <Text style={hs.chipText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Location & hours */}
        <View style={hs.section}>
          <Text style={hs.h2}>Location & hours</Text>
          {restaurant.address ? (
            <Pressable style={hs.metaRow} onPress={handleDirections}>
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={hs.metaText}>{locationText}</Text>
            </Pressable>
          ) : null}
          {openStatus || todayHours ? (
            <View style={hs.metaRow}>
              <MaterialCommunityIcons
                name="clock-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={hs.metaText}>
                {openStatus ? (
                  <Text
                    style={{
                      color: openStatus.open ? colors.success : colors.error,
                      fontFamily: fonts.bold,
                    }}
                  >
                    {openStatus.open ? "Open now" : "Closed"}
                  </Text>
                ) : null}
                {todayHours ? `  ·  Today ${formatDayHours(todayHours)}` : ""}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Menu */}
        {effectiveMenu.length > 0 || isOwner ? (
          <View style={hs.section}>
            <Text style={hs.h2}>Menu</Text>
            {effectiveMenu.length > 0 ? (
              <Pressable
                style={hs.menuBtn}
                onPress={() => setMenuOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="View menu"
              >
                <MaterialCommunityIcons
                  name="silverware-fork-knife"
                  size={18}
                  color={colors.primary}
                />
                <Text style={hs.menuBtnText}>View menu</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={colors.primary}
                  style={hs.menuBtnChevron}
                />
              </Pressable>
            ) : null}
            {isOwner ? (
              <Pressable
                style={[
                  hs.menuBtn,
                  effectiveMenu.length > 0 ? hs.menuBtnStacked : null,
                ]}
                onPress={() => router.push(`/restaurant/${id}/edit-menu`)}
                accessibilityRole="button"
                accessibilityLabel="Edit menu"
              >
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={hs.menuBtnText}>
                  {effectiveMenu.length > 0 ? "Edit menu" : "Add a menu"}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={colors.primary}
                  style={hs.menuBtnChevron}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Save to a list */}
        <View style={hs.section}>
          <Text style={hs.h2}>Save to a list</Text>
          <View style={hs.listRow}>
            <ListChip
              icon="heart"
              label="Favorite"
              active={!!savedStatus.favorite}
              onPress={() => handleSavePress("favorite")}
              disabled={saveBusy}
            />
            <ListChip
              icon="bookmark"
              label="Want to go"
              active={!!savedStatus.want_to_go}
              onPress={() => handleSavePress("want_to_go")}
              disabled={saveBusy}
            />
            <ListChip
              icon="check-circle"
              label="Visited"
              active={!!savedStatus.visited}
              onPress={() => handleSavePress("visited")}
              disabled={saveBusy}
            />
          </View>
          {listsEnabled() ? (
            <Pressable
              style={hs.addCollectionBtn}
              onPress={() => setAddToListOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add to a collection"
            >
              <MaterialCommunityIcons
                name="playlist-plus"
                size={18}
                color={colors.primary}
              />
              <Text style={hs.addCollectionText}>Add to a collection</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ── Community food photos ── */}
      {allPhotoFileIds.length > 0 ? (
        <View style={hs.photosBlock}>
          <Text style={hs.sectionTitle}>Food Photos</Text>
          <FlatList
            horizontal
            data={allPhotoFileIds}
            keyExtractor={(fileId, i) => `photo-${fileId}-${i}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={hs.photosContent}
            renderItem={({ item: fileId, index }) => (
              <Pressable onPress={() => setActivePhotoIndex(index)}>
                <Image
                  source={{ uri: getImageViewUrl(fileId) }}
                  style={hs.photoThumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              </Pressable>
            )}
          />
        </View>
      ) : null}

      {/* ── Reviews section header ── */}
      <View style={hs.reviewsHeader}>
        <Text style={hs.sectionTitle}>Recent Reviews</Text>
        <View style={hs.reviewsHeaderRight}>
          <Pressable
            onPress={handleOpenAllReviews}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`See all ${stats.count} reviews`}
          >
            <Text style={hs.reviewsCount}>
              {stats.count} {stats.count === 1 ? "review" : "reviews"}
            </Text>
          </Pressable>
          {stats.count > REVIEWS_PREVIEW ? (
            <Pressable
              onPress={handleOpenAllReviews}
              hitSlop={8}
            >
              <Text style={hs.seeAll}>See all</Text>
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
        renderItem={({ item }) => {
          const isOwn = user?.id === item.userId;
          return (
            <View style={styles.reviewWrapper}>
              <ReviewItem
                review={item}
                author={reviewAuthors.get(item.userId) ?? null}
                isOwn={isOwn}
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
                onOpen={(r) => router.push(`/review/${r.id}`)}
                ownerReply={ownerResponses.get(item.id) ?? null}
              />
              {/* Dots menu — only on other people's reviews, since the
                  author already has inline Edit/Delete in the row header.
                  Showing dots on own reviews would overlap that. */}
              {!isOwn ? (
                <Pressable
                  style={styles.moreBtn}
                  onPress={() => setReviewToManage(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="More options"
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
        ListHeaderComponent={renderHeader}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 96 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
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
            <View style={styles.emptyCtaWrap}>
              <Button
                label="Write the first review"
                onPress={handleWriteReview}
                fullWidth={false}
                leftIcon={
                  <MaterialCommunityIcons
                    name="pencil"
                    size={16}
                    color={colors.white}
                  />
                }
              />
            </View>
          </View>
        }
      />

      {/* ── Review options bottom sheet — only used for reporting others'
          reviews. Author's own reviews use inline Edit/Delete buttons in
          ReviewItem, so they never open this sheet. ── */}
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

      {/* ── Save confirmation bottom sheet ── */}
      <Modal
        visible={pendingSave !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingSave(null)}
      >
        <Pressable
          style={sheetStyles.overlay}
          onPress={() => setPendingSave(null)}
        >
          <Pressable
            style={sheetStyles.sheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={sheetStyles.handle} />
            {pendingSave ? (
              <>
                <View style={confirmStyles.iconWrap}>
                  <MaterialCommunityIcons
                    name={LIST_TYPE_CONFIG[pendingSave].icon}
                    size={28}
                    color={colors.primary}
                  />
                </View>
                <Text style={confirmStyles.title}>
                  {LIST_TYPE_CONFIG[pendingSave].addTitle}
                </Text>
                <Text style={confirmStyles.body}>
                  {LIST_TYPE_CONFIG[pendingSave].addBody}
                </Text>
                {pendingDisplaces ? (
                  <View style={confirmStyles.displaceRow}>
                    <MaterialCommunityIcons
                      name="information-outline"
                      size={16}
                      color={colors.textMuted}
                    />
                    <Text style={confirmStyles.displaceText}>
                      This will remove it from{" "}
                      {LIST_TYPE_CONFIG[pendingDisplaces].label}.
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  style={confirmStyles.confirmBtn}
                  onPress={handleConfirmSave}
                  disabled={saveBusy}
                >
                  <Text style={confirmStyles.confirmText}>
                    {LIST_TYPE_CONFIG[pendingSave].confirmLabel}
                  </Text>
                </Pressable>
                <Pressable
                  style={sheetStyles.cancelBtn}
                  onPress={() => setPendingSave(null)}
                >
                  <Text style={sheetStyles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
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

      <AddToListSheet
        visible={addToListOpen}
        restaurantId={restaurant.id}
        onClose={() => setAddToListOpen(false)}
      />

      <MenuSheet
        visible={menuOpen}
        sections={effectiveMenu}
        restaurantName={restaurant.name}
        onClose={() => setMenuOpen(false)}
      />

      {/* ── Sticky action bar ── */}
      <View
        style={[
          stickyStyles.bar,
          { paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <Pressable
          onPress={() => handleSavePress("favorite")}
          disabled={saveBusy}
          style={[
            stickyStyles.saveBtn,
            !!savedStatus.favorite && stickyStyles.saveBtnActive,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save to favorites"
        >
          <MaterialCommunityIcons
            name={savedStatus.favorite ? "heart" : "heart-outline"}
            size={24}
            color={savedStatus.favorite ? colors.primary : colors.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={handleDirections}
          style={stickyStyles.dirBtn}
          accessibilityRole="button"
          accessibilityLabel="Directions"
        >
          <MaterialCommunityIcons
            name="directions"
            size={20}
            color={colors.textPrimary}
          />
          <Text style={stickyStyles.dirText}>Directions</Text>
        </Pressable>
        <Pressable
          onPress={handleWriteReview}
          style={stickyStyles.reviewBtn}
          accessibilityRole="button"
          accessibilityLabel={myReview ? "Edit your review" : "Write a review"}
        >
          <MaterialCommunityIcons
            name={myReview ? "pencil" : "star-plus"}
            size={20}
            color={colors.textInverse}
          />
          <Text style={stickyStyles.reviewText}>
            {myReview ? "Edit review" : "Write a review"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Floating frosted button over the hero image.
function FrostBtn({
  icon,
  onPress,
  active,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  active?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[frost.btn, active && frost.btnActive]}
      accessibilityRole="button"
    >
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={active ? colors.primary : "#FFFFFF"}
      />
    </Pressable>
  );
}

// Quick contact tile (Directions / Call / Website / Share).
function QuickTile({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { styles: hs, colors } = useThemedStyles(makeHsStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[hs.quickTile, disabled && hs.quickTileDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={disabled ? colors.textMuted : colors.primary}
      />
      <Text
        style={[hs.quickLabel, disabled && { color: colors.textMuted }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Toggle chip for the "Save to a list" row.
function ListChip({
  icon,
  label,
  active,
  onPress,
  disabled,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { styles: hs, colors } = useThemedStyles(makeHsStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[hs.listChip, active && hs.listChipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <MaterialCommunityIcons
        name={icon}
        size={16}
        color={active ? colors.primary : colors.textSecondary}
      />
      <Text style={[hs.listChipText, active && hs.listChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
  // Error variants — wraps the standardized ErrorState with a back affordance
  // so the user isn't trapped if retry keeps failing.
  errorWrap: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorBackBar: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
  },
  errorBackBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.cardBackground,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
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
  emptyCtaWrap: { marginTop: spacing.lg },
  });
}

function makeHsStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // ── Immersive hero ──
  hero: {
    height: HERO_HEIGHT,
    backgroundColor: colors.surface,
    justifyContent: "flex-end",
  },
  heroPlaceholder: {
    backgroundColor: colors.surface,
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
  topRight: { flexDirection: "row", gap: spacing.sm },
  heroContent: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl + spacing.md,
    gap: spacing.sm,
  },
  heroName: {
    fontFamily: fonts.black,
    fontSize: T.size.xxxl,
    color: "#FFFFFF",
    letterSpacing: T.tracking.tight,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  ratingValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: "#FFFFFF",
  },
  ratingCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: "rgba(255,255,255,0.85)",
  },
  newPill: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  newPillText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: "#FFFFFF",
  },
  heroDot: { color: "rgba(255,255,255,0.6)", fontSize: T.size.sm },
  heroMeta: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: "rgba(255,255,255,0.92)",
    textTransform: "capitalize",
  },
  openBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  openDot: { width: 7, height: 7, borderRadius: radius.full },
  openText: { fontFamily: fonts.bold, fontSize: T.size.xs, color: "#FFFFFF" },

  // ── Content sheet (overlaps the hero) ──
  sheet: {
    backgroundColor: colors.cardBackground,
    marginTop: -radius.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
  },
  quickRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.screen,
    marginBottom: spacing.sm,
  },
  quickTile: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickTileDisabled: { opacity: 0.45 },
  quickLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textPrimary,
  },
  section: { paddingHorizontal: spacing.screen, paddingTop: spacing.lg },
  h2: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    marginBottom: spacing.sm,
  },
  menuBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  menuBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.primary,
  },
  menuBtnChevron: { marginLeft: "auto" },
  menuBtnStacked: { marginTop: spacing.sm },
  body: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    lineHeight: 23,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
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
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metaText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.subDetail,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  listRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  listChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  listChipText: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  listChipTextActive: { color: colors.primary, fontFamily: fonts.bold },
  addCollectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.cardBackground,
  },
  addCollectionText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },

  // ── Photos + reviews ──
  photosBlock: { paddingTop: spacing.xl, paddingBottom: spacing.sm },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    paddingHorizontal: spacing.screen,
    marginBottom: spacing.md,
  },
  photosContent: { paddingHorizontal: spacing.screen, gap: spacing.md },
  photoThumb: {
    width: 120,
    height: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  reviewsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  reviewsHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  reviewsCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  seeAll: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  });
}

const frost = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: "rgba(20,20,20,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: { backgroundColor: "#FFFFFF" },
});

function makeStickyStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    backgroundColor: colors.cardBackground,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadows.md,
  },
  saveBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtnActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  dirBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dirText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  reviewBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  reviewText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
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

// Confirmation sheet styles — separate from the generic sheetStyles so the
// "Add to Favorites?" layout (icon + headline + body + primary button)
// reads as a clear yes/no decision rather than an action list.
function makeConfirmStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  displaceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  displaceText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    ...shadows.sm,
  },
  confirmText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  });
}

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
