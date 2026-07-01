// src/components/ProfileView.tsx
// Shared profile content for "my profile" and "view user" routes.
//
// Loads in parallel:
//   - user document (PRIMARY — failure here means full-screen error)
//   - review stats
//   - follower / following counts
//   - is-current-user-following-target boolean
//   - has-current-user-blocked-target boolean
//   - first page of reviews
//   - hydrated restaurants for those reviews
//
// Optimistic follow toggle: UI updates immediately; server call happens in
// the background; failure reverts state. Block toggle works the same way and
// is passed down to ProfileHeader (which renders the ⋯ menu).
//
// Three content tabs (own profile) / two (other profiles):
//   "all"   → the user's reviews (loaded eagerly with the profile)
//   "likes" → reviews the user has liked (lazy-loaded on first visit)
//   "saved" → favorites preview, up to 5, with "See all" → /(tabs)/saved
//             (hidden entirely on other users' profiles; data layer also
//              enforces privacy via per-doc Read on the saved collection)
//
// Lazy-loading strategy for likes + saved:
//   We don't fetch either in the initial parallel load — both are secondary
//   surfaces and most opens of the profile never touch them. First time
//   the user taps the tab we fetch; subsequent visits reuse what's in state
//   (refresh-to-reload via pull-to-refresh).
//
// Visual: whole component is on the white cardBackground surface to match
// Community/Saved. The minimal stats row + content tabs together make up
// the FlatList header.
//
// Failure handling:
//   - PRIMARY (getUserById) failing → full-screen ErrorState with retry.
//     There's nothing to render without a user.
//   - SECONDARY fetches (stats, follow counts, reviews) failing → the
//     profile still renders with the user info; affected sections show
//     zeroes or "no reviews yet" placeholders. Better than a blank wall
//     when a single sub-query hiccups.
//   - Lazy tab loads (likes, saved) on failure → the tab's "error" status
//     stays set; user sees an inline ErrorState in the empty area with
//     a retry button. We don't pollute the rest of the profile.

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

import { ErrorState } from "@/components/ErrorState";
import { ListCard } from "@/components/ListCard";
import {
  ProfileContentTabs,
  type ProfileContentTab,
} from "@/components/ProfileContentTabs";
import { ProfileHeader } from "@/components/ProfileHeader";
import { RestaurantSmallCard } from "@/components/RestaurantSmallCard";
import {
  UserReviewItem,
  UserReviewItemSkeleton,
} from "@/components/UserReviewItem";
import { useGuardedAction } from "@/hooks/useGuardedAction";
import {
  blockUser,
  isBlocked as checkIsBlocked,
  getHiddenUserIds,
  unblockUser,
} from "@/services/blocks";
import {
  isFollowing as checkIsFollowing,
  followUser,
  getFollowCounts,
  unfollowUser,
} from "@/services/follows";
import {
  listMyLists,
  listPublicListsByUser,
  listsEnabled,
} from "@/services/lists";
import { getRestaurantsByIds } from "@/services/restaurants";
import { listLikedReviewsByUser } from "@/services/reviewLikes";
import { getUserReviewStats, listReviewsByUser } from "@/services/reviews";
import { listSavedRestaurants } from "@/services/saved";
import { captureError } from "@/services/sentry";
import { getImageViewUrl } from "@/services/storage";
import { getUserById } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";
import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

const { width: SW } = Dimensions.get("window");
const PAGE_SIZE = 20;

// Saved-tab grid: two compact cards per row, sized to the screen minus the page
// padding and the inter-card gap.
const SAVED_CARD_WIDTH = (SW - spacing.screen * 2 - spacing.md) / 2;

// Saved-tab preview cap. We fetch one extra (6) so we can detect overflow
// and conditionally render the "See all" footer.
const SAVED_PREVIEW_LIMIT = 5;
const SAVED_FETCH_LIMIT = SAVED_PREVIEW_LIMIT + 1;

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
  // isBlocked = I blocked them (drives the Unblock affordance).
  isBlocked: boolean;
  // blockedByThem = they blocked me (and I didn't block them). Either flag
  // hides their content; only isBlocked lets me unblock.
  blockedByThem: boolean;
  reviews: Review[];
  restaurants: Map<string, Restaurant>;
  nextCursor: string | null;
  hasMore: boolean;
  // Likes tab — populated on first visit, kept around for the session.
  likedReviews: Review[];
  likedRestaurants: Map<string, Restaurant>;
  likedNextCursor: string | null;
  likedHasMore: boolean;
  likedStatus: "idle" | "loading" | "ready" | "error";
  // Saved tab — own profile only. Holds up to SAVED_FETCH_LIMIT items;
  // savedHasMore is true when the fetch returned more than the preview cap.
  savedFavorites: Restaurant[];
  savedHasMore: boolean;
  savedStatus: "idle" | "loading" | "ready" | "error";
  // Lists (Collections) tab — public lists for others, all for self. Lazy.
  lists: List[];
  listCovers: Map<string, string | null>;
  listsStatus: "idle" | "loading" | "ready" | "error";
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: Data };

export function ProfileView({
  userId,
  isOwn,
  variant = "default",
  onEditPress,
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
  const { styles, colors } = useThemedStyles(makeStyles);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setState({ status: "loading" });

      // Step 1 — PRIMARY: fetch the user. Without this, nothing else
      // makes sense to show.
      let user: User | null;
      try {
        user = await getUserById(userId);
      } catch (err) {
        captureError(err, {
          screen: "profile",
          op: "load.getUserById",
          targetUserId: userId,
        });
        setState({
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
        setRefreshing(false);
        return;
      }

      if (!user) {
        setState({
          status: "error",
          error: new Error("User not found."),
        });
        setRefreshing(false);
        return;
      }

      // Step 2 — SECONDARY: everything else in parallel. Use allSettled so
      // one piece failing doesn't kill the profile — the user header
      // still renders even if review stats or follow counts misbehave.
      const [
        statsResult,
        followCountsResult,
        isFollowingResult,
        isBlockedResult,
        reviewsResult,
        hiddenResult,
      ] = await Promise.allSettled([
        getUserReviewStats(userId),
        getFollowCounts(userId),
        isOwn ? Promise.resolve(false) : checkIsFollowing(userId),
        isOwn ? Promise.resolve(false) : checkIsBlocked(userId),
        listReviewsByUser(userId, { pageSize: PAGE_SIZE }),
        isOwn ? Promise.resolve(new Set<string>()) : getHiddenUserIds(),
      ]);

      const stats =
        statsResult.status === "fulfilled"
          ? statsResult.value
          : { reviewCount: 0, averageRating: 0, parishesVisited: 0 };
      if (statsResult.status === "rejected") {
        captureError(statsResult.reason, {
          screen: "profile",
          op: "load.getUserReviewStats",
          targetUserId: userId,
        });
      }

      const followCounts =
        followCountsResult.status === "fulfilled"
          ? followCountsResult.value
          : { followerCount: 0, followingCount: 0 };
      if (followCountsResult.status === "rejected") {
        captureError(followCountsResult.reason, {
          screen: "profile",
          op: "load.getFollowCounts",
          targetUserId: userId,
        });
      }

      const isFollowingTarget =
        isFollowingResult.status === "fulfilled"
          ? isFollowingResult.value
          : false;
      if (isFollowingResult.status === "rejected") {
        captureError(isFollowingResult.reason, {
          screen: "profile",
          op: "load.isFollowing",
          targetUserId: userId,
        });
      }

      const isBlockedTarget =
        isBlockedResult.status === "fulfilled" ? isBlockedResult.value : false;
      if (isBlockedResult.status === "rejected") {
        captureError(isBlockedResult.reason, {
          screen: "profile",
          op: "load.isBlocked",
          targetUserId: userId,
        });
      }

      // Mutual block set (people I blocked + who blocked me). If the target is
      // in it but I didn't block them, then THEY blocked me. Tolerant: a failed
      // lookup degrades to "not blocked" rather than wrongly hiding a profile.
      const hiddenSet =
        hiddenResult.status === "fulfilled"
          ? hiddenResult.value
          : new Set<string>();
      if (hiddenResult.status === "rejected") {
        captureError(hiddenResult.reason, {
          screen: "profile",
          op: "load.getHiddenUserIds",
          targetUserId: userId,
        });
      }
      const blockedByThemTarget = hiddenSet.has(userId) && !isBlockedTarget;

      // Reviews — if this throws, show the user header but with an empty
      // "all" tab. The empty-state copy ("haven't reviewed anything") is
      // misleading in this case, but we report to Sentry so we know it's
      // failing in the wild.
      let reviews: Review[] = [];
      let nextCursor: string | null = null;
      let hasMore = false;
      if (reviewsResult.status === "fulfilled") {
        reviews = reviewsResult.value.items;
        nextCursor = reviewsResult.value.nextCursor;
        hasMore = reviewsResult.value.hasMore;
      } else {
        captureError(reviewsResult.reason, {
          screen: "profile",
          op: "load.listReviewsByUser",
          targetUserId: userId,
        });
      }

      // Step 3 — hydrate restaurants for the reviews we got back. Tolerant
      // — empty map is fine, the cards will render without restaurant data.
      let restaurants = new Map<string, Restaurant>();
      if (reviews.length > 0) {
        try {
          const restaurantIds = reviews.map((r) => r.restaurantId);
          restaurants = await getRestaurantsByIds(restaurantIds);
        } catch (err) {
          captureError(err, {
            screen: "profile",
            op: "load.getRestaurantsByIds",
            targetUserId: userId,
          });
        }
      }

      setState({
        status: "ready",
        data: {
          user,
          stats,
          followerCount: followCounts.followerCount,
          followingCount: followCounts.followingCount,
          isFollowing: isFollowingTarget,
          isBlocked: isBlockedTarget,
          blockedByThem: blockedByThemTarget,
          reviews,
          restaurants,
          nextCursor,
          hasMore,
          // Likes + Saved tabs start empty; lazy-loaded on first tap.
          // On refresh both reset so the next visit refetches.
          likedReviews: [],
          likedRestaurants: new Map(),
          likedNextCursor: null,
          likedHasMore: false,
          likedStatus: "idle",
          savedFavorites: [],
          savedHasMore: false,
          savedStatus: "idle",
          lists: [],
          listCovers: new Map(),
          listsStatus: "idle",
        },
      });
      setRefreshing(false);
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

  // Fetch the first page of likes. Called lazily on first Likes-tab tap.
  const loadLikes = useCallback(async () => {
    if (state.status !== "ready") return;
    if (state.data.likedStatus === "loading") return;

    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        status: "ready",
        data: { ...prev.data, likedStatus: "loading" },
      };
    });

    try {
      const page = await listLikedReviewsByUser(userId, {
        pageSize: PAGE_SIZE,
      });
      const restaurantIds = page.items.map((r) => r.restaurantId);
      const restaurants = await getRestaurantsByIds(restaurantIds);

      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: {
            ...prev.data,
            likedReviews: page.items,
            likedRestaurants: restaurants,
            likedNextCursor: page.nextCursor,
            likedHasMore: page.hasMore,
            likedStatus: "ready",
          },
        };
      });
    } catch (err) {
      captureError(err, {
        screen: "profile",
        op: "loadLikes",
        targetUserId: userId,
      });
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: { ...prev.data, likedStatus: "error" },
        };
      });
    }
  }, [state, userId]);

  // Fetch the favorites preview for the Saved tab. Own profile only —
  // we don't even surface the tab elsewhere. Uses listSavedRestaurants
  // which reads account.get() under the hood; that's fine because we
  // only call this when isOwn === true.
  const loadSaved = useCallback(async () => {
    if (state.status !== "ready") return;
    if (!isOwn) return;
    if (state.data.savedStatus === "loading") return;

    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        status: "ready",
        data: { ...prev.data, savedStatus: "loading" },
      };
    });

    try {
      const results = await listSavedRestaurants("favorite", SAVED_FETCH_LIMIT);
      // Filter out deleted restaurants — same pattern as the saved tab.
      const restaurants = results
        .map((r) => r.restaurant)
        .filter((r): r is Restaurant => r !== null);
      const hasMore = restaurants.length > SAVED_PREVIEW_LIMIT;
      const preview = restaurants.slice(0, SAVED_PREVIEW_LIMIT);

      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: {
            ...prev.data,
            savedFavorites: preview,
            savedHasMore: hasMore,
            savedStatus: "ready",
          },
        };
      });
    } catch (err) {
      captureError(err, {
        screen: "profile",
        op: "loadSaved",
      });
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: { ...prev.data, savedStatus: "error" },
        };
      });
    }
  }, [state, isOwn]);

  // Fetch the user's collections. Own profile → all of mine; other users →
  // their public collections only. Lazy-loaded on first Lists-tab tap.
  const loadLists = useCallback(async () => {
    if (state.status !== "ready") return;
    if (state.data.listsStatus === "loading") return;

    setState((prev) =>
      prev.status === "ready"
        ? { status: "ready", data: { ...prev.data, listsStatus: "loading" } }
        : prev,
    );

    try {
      const fetched = isOwn
        ? await listMyLists()
        : await listPublicListsByUser(userId);
      // Hydrate cover images for the cards.
      const coverIds = fetched
        .map((l) => l.coverRestaurantId ?? l.restaurantIds[0] ?? null)
        .filter((x): x is string => !!x);
      const covers = new Map<string, string | null>();
      if (coverIds.length > 0) {
        const restMap = await getRestaurantsByIds(coverIds);
        for (const l of fetched) {
          const rid = l.coverRestaurantId ?? l.restaurantIds[0] ?? null;
          const r = rid ? restMap.get(rid) : null;
          covers.set(l.id, r?.coverImageId ?? r?.imageIds[0] ?? null);
        }
      }
      setState((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              data: {
                ...prev.data,
                lists: fetched,
                listCovers: covers,
                listsStatus: "ready",
              },
            }
          : prev,
      );
    } catch (err) {
      captureError(err, {
        screen: "profile",
        op: "loadLists",
        targetUserId: userId,
      });
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", data: { ...prev.data, listsStatus: "error" } }
          : prev,
      );
    }
  }, [state, isOwn, userId]);

  // Wrap the tab change so first-tap on Likes or Saved triggers a fetch.
  const handleTabChange = useCallback(
    (tab: ProfileContentTab) => {
      setActiveTab(tab);
      if (state.status !== "ready") return;
      if (tab === "likes" && state.data.likedStatus === "idle") {
        loadLikes();
      } else if (tab === "lists" && state.data.listsStatus === "idle") {
        loadLists();
      } else if (
        tab === "saved" &&
        isOwn &&
        state.data.savedStatus === "idle"
      ) {
        loadSaved();
      }
    },
    [state, isOwn, loadLikes, loadLists, loadSaved],
  );

  const handleLoadMore = useCallback(async () => {
    if (state.status !== "ready" || loadingMore) return;

    if (activeTab === "all") {
      if (!state.data.hasMore) return;
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
        // Silent UI failure on pagination — Sentry-only. First page is
        // already rendered; the user can pull-to-refresh.
        captureError(err, {
          screen: "profile",
          op: "loadMore.all",
          targetUserId: userId,
        });
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    if (activeTab === "likes") {
      if (!state.data.likedHasMore) return;
      if (state.data.likedStatus !== "ready") return;
      setLoadingMore(true);
      try {
        const page = await listLikedReviewsByUser(userId, {
          pageSize: PAGE_SIZE,
          cursor: state.data.likedNextCursor,
        });
        const restaurantIds = page.items.map((r) => r.restaurantId);
        const newRestaurants = await getRestaurantsByIds(restaurantIds);
        setState((prev) => {
          if (prev.status !== "ready") return prev;
          const mergedRestaurants = new Map([
            ...prev.data.likedRestaurants,
            ...newRestaurants,
          ]);
          return {
            status: "ready",
            data: {
              ...prev.data,
              likedReviews: [...prev.data.likedReviews, ...page.items],
              likedRestaurants: mergedRestaurants,
              likedNextCursor: page.nextCursor,
              likedHasMore: page.hasMore,
            },
          };
        });
      } catch (err) {
        captureError(err, {
          screen: "profile",
          op: "loadMore.likes",
          targetUserId: userId,
        });
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    // "saved" tab — preview only, no pagination. "See all" routes to /(tabs)/saved.
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
      captureError(err, {
        screen: "profile",
        op: wasFollowing ? "unfollow" : "follow",
        targetUserId: userId,
      });
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

  // Optimistic block toggle — mirrors follow. ProfileHeader shows its own
  // busy spinner while this promise is in flight.
  const handleToggleBlock = useCallback(async () => {
    if (state.status !== "ready" || isOwn) return;
    const wasBlocked = state.data.isBlocked;

    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        status: "ready",
        data: { ...prev.data, isBlocked: !wasBlocked },
      };
    });

    try {
      if (wasBlocked) {
        await unblockUser(userId);
      } else {
        await blockUser(userId);
      }
    } catch (err) {
      captureError(err, {
        screen: "profile",
        op: wasBlocked ? "unblock" : "block",
        targetUserId: userId,
      });
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          status: "ready",
          data: { ...prev.data, isBlocked: wasBlocked },
        };
      });
      Alert.alert(
        wasBlocked ? "Couldn't unblock" : "Couldn't block",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, [state, isOwn, userId]);

  // Collapse rapid double-taps into a single in-flight request. These toggles
  // are optimistic, so without a guard two fast taps fire two racing calls.
  const { run: toggleFollow } = useGuardedAction(handleToggleFollow);
  const { run: toggleBlock } = useGuardedAction(handleToggleBlock);

  const handleRestaurantPress = useCallback(
    (restaurantId: string) => {
      router.push(`/restaurant/${restaurantId}`);
    },
    [router],
  );

  const handleSeeAllSaved = useCallback(() => {
    // Land on Favorites sub-tab. The /(tabs)/saved screen reads ?tab=
    // and initializes activeTab from it.
    router.push("/(tabs)/saved?tab=favorite");
  }, [router]);

  const handlePhotoTap = useCallback(
    (imageIds: string[], startIndex: number) => {
      setActivePhotoSet(imageIds);
      setActivePhotoIndex(startIndex);
    },
    [],
  );

  // Initial profile load — skeleton mirrors the real layout: a header
  // block placeholder + 3 review-item placeholders. The ProfileHeader is
  // complex (avatar, bio, stats, action button) so we use a simple stack
  // of generic skeleton blocks rather than building a header-specific
  // skeleton component for it.
  if (state.status === "loading") {
    return (
      <View style={styles.wrap}>
        <View style={styles.headerSkeleton}>
          {/* Avatar + name area */}
          <View style={{ alignItems: "center", gap: spacing.md }}>
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: colors.pageBackground,
              }}
            />
            {/* Name line */}
            <View
              style={{
                width: 160,
                height: 18,
                borderRadius: 4,
                backgroundColor: colors.pageBackground,
              }}
            />
            {/* Handle line */}
            <View
              style={{
                width: 100,
                height: 12,
                borderRadius: 4,
                backgroundColor: colors.pageBackground,
              }}
            />
          </View>

          {/* Stats row */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-around",
              marginTop: spacing.xl,
              paddingHorizontal: spacing.lg,
            }}
          >
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ alignItems: "center", gap: spacing.xs }}>
                <View
                  style={{
                    width: 36,
                    height: 22,
                    borderRadius: 4,
                    backgroundColor: colors.pageBackground,
                  }}
                />
                <View
                  style={{
                    width: 60,
                    height: 10,
                    borderRadius: 4,
                    backgroundColor: colors.pageBackground,
                  }}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Tab bar placeholder + review skeletons */}
        <View style={{ height: spacing.lg }} />
        <UserReviewItemSkeleton />
        <View style={{ height: spacing.md }} />
        <UserReviewItemSkeleton />
        <View style={{ height: spacing.md }} />
        <UserReviewItemSkeleton />
      </View>
    );
  }

  if (state.status === "error") {
    // Standardized ErrorState — same look as Community + restaurant detail.
    return (
      <View style={styles.wrap}>
        <ErrorState
          variant="screen"
          icon="account-alert-outline"
          title="Couldn't load this profile"
          body="Check your connection and try again."
          onRetry={() => load()}
        />
      </View>
    );
  }

  const {
    user,
    stats,
    reviews,
    restaurants,
    isFollowing,
    isBlocked,
    blockedByThem,
    followerCount,
    followingCount,
    likedReviews,
    likedRestaurants,
    likedStatus,
    savedFavorites,
    savedHasMore,
    savedStatus,
    lists,
    listCovers,
    listsStatus,
  } = state.data;

  // ── Block interstitials ──────────────────────────────────────────────────
  // They blocked me (and I didn't block them): neutral "unavailable" screen,
  // no name/stats/reviews, no unblock (I can't undo a block I didn't create).
  if (blockedByThem) {
    return (
      <View style={styles.wrap}>
        <ErrorState
          variant="screen"
          icon="account-off-outline"
          title="This profile isn't available"
          body="You can't view this profile right now."
        />
      </View>
    );
  }

  // I blocked them: hide their reviews/tabs, show who it is + an Unblock action.
  if (isBlocked) {
    return (
      <View style={styles.wrap}>
        <View style={styles.blockedContainer}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons
              name="block-helper"
              size={32}
              color={colors.primary}
            />
          </View>
          <Text style={styles.emptyTitle}>You blocked {user.displayName}</Text>
          <Text style={styles.emptyBody}>
            Their reviews are hidden, and they can&apos;t see yours.
          </Text>
          <Pressable
            onPress={handleToggleBlock}
            style={styles.unblockBtn}
            accessibilityRole="button"
            accessibilityLabel={`Unblock ${user.displayName}`}
          >
            <MaterialCommunityIcons
              name="account-check-outline"
              size={18}
              color={colors.textInverse}
            />
            <Text style={styles.unblockText}>Unblock</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Saved tab uses its own renderer below; for the "all" and "likes" tabs
  // we feed the FlatList an array of reviews. On the Saved tab we feed it
  // an empty array and render the favorites grid inside ListEmptyComponent
  // so we keep one FlatList (pull-to-refresh + header stays consistent).
  const listData =
    activeTab === "all" ? reviews : activeTab === "likes" ? likedReviews : [];
  const restaurantMap = activeTab === "likes" ? likedRestaurants : restaurants;

  // Tab-specific loading state for the empty area
  const showLikesLoading =
    activeTab === "likes" &&
    likedStatus === "loading" &&
    likedReviews.length === 0;
  const showSavedLoading =
    activeTab === "saved" &&
    savedStatus === "loading" &&
    savedFavorites.length === 0;

  // Tab-specific error state. We surface these inline (the rest of the
  // profile keeps rendering) because the tabs are independently loadable.
  const showLikesError =
    activeTab === "likes" &&
    likedStatus === "error" &&
    likedReviews.length === 0;
  const showSavedError =
    activeTab === "saved" &&
    savedStatus === "error" &&
    savedFavorites.length === 0;
  const showListsLoading =
    activeTab === "lists" && listsStatus === "loading" && lists.length === 0;
  const showListsError =
    activeTab === "lists" && listsStatus === "error" && lists.length === 0;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <UserReviewItem
            review={item}
            restaurant={restaurantMap.get(item.restaurantId) ?? null}
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
              onToggleFollow={!isOwn ? toggleFollow : undefined}
              isBlocked={isBlocked}
              onToggleBlock={!isOwn ? toggleBlock : undefined}
              onFollowersPress={onFollowersPress}
              onFollowingPress={onFollowingPress}
            />
            <ProfileContentTabs
              active={activeTab}
              onChange={handleTabChange}
              isOwn={isOwn}
              showLists={listsEnabled()}
            />
            {/* Breathing room so the first review card (or saved grid) doesn't
                jam directly against the tab strip's bottom hairline. List
                separators only render BETWEEN items, never before the first. */}
            <View style={styles.tabsSpacer} />
          </>
        }
        ListEmptyComponent={
          showLikesLoading || showSavedLoading || showListsLoading ? (
            <View style={styles.tabLoader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : showLikesError ? (
            <ErrorState
              variant="inline"
              icon="cloud-off-outline"
              title="Couldn't load likes"
              body="Tap to try again."
              onRetry={loadLikes}
            />
          ) : showSavedError ? (
            <ErrorState
              variant="inline"
              icon="cloud-off-outline"
              title="Couldn't load favorites"
              body="Tap to try again."
              onRetry={loadSaved}
            />
          ) : showListsError ? (
            <ErrorState
              variant="inline"
              icon="cloud-off-outline"
              title="Couldn't load collections"
              body="Tap to try again."
              onRetry={loadLists}
            />
          ) : activeTab === "lists" ? (
            lists.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name="bookmark-multiple-outline"
                    size={32}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {isOwn ? "No collections yet" : "No public collections"}
                </Text>
                <Text style={styles.emptyBody}>
                  {isOwn
                    ? "Curate shareable lists like “Best jerk in Kingston.”"
                    : `${user.displayName} hasn't shared any collections.`}
                </Text>
                {isOwn ? (
                  <Pressable
                    onPress={() => router.push("/list/new")}
                    style={styles.newListBtn}
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons
                      name="plus"
                      size={18}
                      color={colors.textInverse}
                    />
                    <Text style={styles.newListText}>New collection</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.listsSection}>
                {isOwn ? (
                  <Pressable
                    onPress={() => router.push("/list/new")}
                    style={styles.newListRow}
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons
                      name="plus-circle-outline"
                      size={22}
                      color={colors.primary}
                    />
                    <Text style={styles.newListRowText}>New collection</Text>
                  </Pressable>
                ) : null}
                {lists.map((list) => (
                  <ListCard
                    key={list.id}
                    list={list}
                    coverImageId={listCovers.get(list.id)}
                    onPress={(listId) =>
                      router.push({
                        pathname: "/list/[id]",
                        params: { id: listId },
                      })
                    }
                  />
                ))}
              </View>
            )
          ) : activeTab === "all" ? (
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
              <Text style={styles.emptyTitle}>
                {isOwn ? "No liked reviews yet" : "No liked reviews"}
              </Text>
              <Text style={styles.emptyBody}>
                {isOwn
                  ? "Reviews you like will appear here."
                  : `${user.displayName} hasn't liked any reviews yet.`}
              </Text>
            </View>
          ) : isOwn ? (
            // Saved tab — favorites preview (own profile only)
            savedFavorites.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name="heart-outline"
                    size={32}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>No favorites yet</Text>
                <Text style={styles.emptyBody}>
                  Tap the heart on any restaurant to add it here for quick
                  access.
                </Text>
              </View>
            ) : (
              <View style={styles.savedSection}>
                <View style={styles.savedGrid}>
                  {savedFavorites.map((restaurant) => (
                    <RestaurantSmallCard
                      key={restaurant.id}
                      restaurant={restaurant}
                      onPress={handleRestaurantPress}
                      width={SAVED_CARD_WIDTH}
                    />
                  ))}
                </View>
                {savedHasMore ? (
                  <Pressable
                    onPress={handleSeeAllSaved}
                    style={styles.seeAllBtn}
                    accessibilityRole="button"
                    accessibilityLabel="See all saved favorites"
                  >
                    <Text style={styles.seeAllLabel}>See all favorites</Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={18}
                      color={colors.primary}
                    />
                  </Pressable>
                ) : null}
              </View>
            )
          ) : null
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

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Make the whole component sit on the card surface
  wrap: { flex: 1, backgroundColor: colors.cardBackground },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBackground,
  },
  listContent: { paddingBottom: 100 },
  // Sits between the content-tab strip and the first list row.
  tabsSpacer: { height: spacing.md },
  // Header-area placeholder before the tab bar mounts. Matches the rough
  // vertical space the real ProfileHeader takes.
  headerSkeleton: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
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
  // "You blocked this user" interstitial — centered, with an Unblock button.
  blockedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  unblockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  unblockText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  footerLoader: { paddingVertical: spacing.lg },
  tabLoader: { paddingVertical: spacing.huge, alignItems: "center" },

  // Saved-tab preview list (own profile only). No top padding — the
  // tabsSpacer in the list header already provides the gap below the tabs.
  savedSection: {
    paddingTop: 0,
    paddingHorizontal: 0,
  },
  // Two-column grid of compact cards.
  savedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.screen,
    gap: spacing.md,
  },
  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.screen,
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  seeAllLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  listsSection: { paddingTop: 0 },
  newListRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  newListRowText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.primary,
  },
  newListBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  newListText: {
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
