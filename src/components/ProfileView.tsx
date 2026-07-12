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
// Content tabs:
//   "all"   → the user's reviews (loaded eagerly with the profile)
//   "likes" → reviews the user has liked (lazy-loaded on first visit)
//   "lists" → the user's collections (lazy-loaded; public-only for others)
//   (Saved is NOT a profile tab — it lives on its own bottom-nav tab.)
//
// Lazy-loading strategy for likes + lists:
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
//   - Lazy tab loads (likes, lists) on failure → the tab's "error" status
//     stays set; user sees an inline ErrorState in the empty area with
//     a retry button. We don't pollute the rest of the profile.

import {
  Ban,
  CirclePlus,
  CloudOff,
  Heart,
  Library,
  MessageSquareText,
  Plus,
  UserCheck,
  UserRoundX,
  UserX,
} from "lucide-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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

import { ErrorState } from "@/components/ErrorState";
import { LikedPostItem } from "@/components/LikedPostItem";
import { ListCard } from "@/components/ListCard";
import {
  ProfileContentTabs,
  type ProfileContentTab,
} from "@/components/ProfileContentTabs";
import { PhotoViewer } from "@/components/PhotoViewer";
import { ProfileHeader } from "@/components/ProfileHeader";
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
import { listLikedPostsByUser } from "@/services/postLikes";
import { getRestaurantsByIds } from "@/services/restaurants";
import { listLikedReviewsByUser } from "@/services/reviewLikes";
import { getUserReviewStats, listReviewsByUser } from "@/services/reviews";
import { captureError } from "@/services/sentry";
import { getImageViewUrl } from "@/services/storage";
import { getUserById, getUsersByIds } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";
import type { Post } from "@/types/post";
import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

const PAGE_SIZE = 20;

// One FlatList row — the Likes tab mixes liked reviews with liked community
// posts, so rows carry a discriminant instead of being bare Reviews.
type FeedRow =
  | { kind: "review"; review: Review }
  | { kind: "post"; post: Post };

// Stable row key; doubles as the lookup key into likedAtByKey.
function rowKey(row: FeedRow): string {
  return row.kind === "review"
    ? `review:${row.review.id}`
    : `post:${row.post.id}`;
}

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
  // Likes tab — liked reviews AND liked community posts, merged by like
  // recency. Populated on first visit, kept around for the session. Each
  // source paginates independently (cursor lives on its likes collection);
  // likedAtByKey ("review:<id>" / "post:<id>" → like time) drives the merge.
  likedReviews: Review[];
  likedRestaurants: Map<string, Restaurant>;
  likedNextCursor: string | null;
  likedHasMore: boolean;
  likedPosts: Post[];
  likedPostAuthors: Map<string, User>;
  likedPostsNextCursor: string | null;
  likedPostsHasMore: boolean;
  likedAtByKey: Map<string, string>;
  likedStatus: "idle" | "loading" | "ready" | "error";
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
          // Likes + Lists tabs start empty; lazy-loaded on first tap.
          // On refresh both reset so the next visit refetches.
          likedReviews: [],
          likedRestaurants: new Map(),
          likedNextCursor: null,
          likedHasMore: false,
          likedPosts: [],
          likedPostAuthors: new Map(),
          likedPostsNextCursor: null,
          likedPostsHasMore: false,
          likedAtByKey: new Map(),
          likedStatus: "idle",
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

  // Fetch the first page of likes — liked reviews AND liked posts, in
  // parallel. Called lazily on first Likes-tab tap. The posts fetch is
  // tolerant (empty page on failure), so only a reviews failure errors
  // the tab.
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
      const [page, postPage] = await Promise.all([
        listLikedReviewsByUser(userId, { pageSize: PAGE_SIZE }),
        listLikedPostsByUser(userId, { pageSize: PAGE_SIZE }),
      ]);
      const restaurantIds = page.items.map((r) => r.restaurantId);
      const authorIds = postPage.items.map((p) => p.userId);
      const [restaurants, authors] = await Promise.all([
        getRestaurantsByIds(restaurantIds),
        getUsersByIds(authorIds),
      ]);

      const likedAtByKey = new Map<string, string>();
      for (const [id, at] of page.likedAt) likedAtByKey.set(`review:${id}`, at);
      for (const [id, at] of postPage.likedAt) likedAtByKey.set(`post:${id}`, at);

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
            likedPosts: postPage.items,
            likedPostAuthors: authors,
            likedPostsNextCursor: postPage.nextCursor,
            likedPostsHasMore: postPage.hasMore,
            likedAtByKey,
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

  // Wrap the tab change so first-tap on Likes or Lists triggers a fetch.
  const handleTabChange = useCallback(
    (tab: ProfileContentTab) => {
      setActiveTab(tab);
      if (state.status !== "ready") return;
      if (tab === "likes" && state.data.likedStatus === "idle") {
        loadLikes();
      } else if (tab === "lists" && state.data.listsStatus === "idle") {
        loadLists();
      }
    },
    [state, loadLikes, loadLists],
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
      if (!state.data.likedHasMore && !state.data.likedPostsHasMore) return;
      if (state.data.likedStatus !== "ready") return;
      setLoadingMore(true);
      try {
        // Advance whichever sources still have pages, in parallel. The merged
        // list re-sorts by like time, so uneven page depths stay in order.
        const [page, postPage] = await Promise.all([
          state.data.likedHasMore
            ? listLikedReviewsByUser(userId, {
                pageSize: PAGE_SIZE,
                cursor: state.data.likedNextCursor,
              })
            : null,
          state.data.likedPostsHasMore
            ? listLikedPostsByUser(userId, {
                pageSize: PAGE_SIZE,
                cursor: state.data.likedPostsNextCursor,
              })
            : null,
        ]);
        const restaurantIds = page?.items.map((r) => r.restaurantId) ?? [];
        const authorIds = postPage?.items.map((p) => p.userId) ?? [];
        const [newRestaurants, newAuthors] = await Promise.all([
          getRestaurantsByIds(restaurantIds),
          getUsersByIds(authorIds),
        ]);
        setState((prev) => {
          if (prev.status !== "ready") return prev;
          const likedAtByKey = new Map(prev.data.likedAtByKey);
          for (const [id, at] of page?.likedAt ?? [])
            likedAtByKey.set(`review:${id}`, at);
          for (const [id, at] of postPage?.likedAt ?? [])
            likedAtByKey.set(`post:${id}`, at);
          return {
            status: "ready",
            data: {
              ...prev.data,
              likedReviews: page
                ? [...prev.data.likedReviews, ...page.items]
                : prev.data.likedReviews,
              likedRestaurants: new Map([
                ...prev.data.likedRestaurants,
                ...newRestaurants,
              ]),
              likedNextCursor: page
                ? page.nextCursor
                : prev.data.likedNextCursor,
              likedHasMore: page ? page.hasMore : prev.data.likedHasMore,
              likedPosts: postPage
                ? [...prev.data.likedPosts, ...postPage.items]
                : prev.data.likedPosts,
              likedPostAuthors: new Map([
                ...prev.data.likedPostAuthors,
                ...newAuthors,
              ]),
              likedPostsNextCursor: postPage
                ? postPage.nextCursor
                : prev.data.likedPostsNextCursor,
              likedPostsHasMore: postPage
                ? postPage.hasMore
                : prev.data.likedPostsHasMore,
              likedAtByKey,
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

  const handlePostPress = useCallback(
    (postId: string) => {
      router.push(`/post/${postId}`);
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
          icon={UserRoundX}
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
    likedPosts,
    likedPostAuthors,
    likedAtByKey,
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
          icon={UserX}
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
            <Ban size={30} color={colors.textPrimary} strokeWidth={1.8} />
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
            <UserCheck size={17} color={colors.onPrimary} strokeWidth={2} />
            <Text style={styles.unblockText}>Unblock</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // The "all" tab feeds the FlatList the user's reviews; the Likes tab feeds
  // a merged list of liked reviews + liked posts sorted by like recency
  // (likedAtByKey). The Lists tab feeds an empty array and renders inside
  // ListEmptyComponent so we keep one FlatList (pull-to-refresh + header
  // stays consistent).
  const likedEntries: FeedRow[] =
    activeTab === "likes"
      ? [
          ...likedReviews.map((r) => ({ kind: "review" as const, review: r })),
          ...likedPosts.map((p) => ({ kind: "post" as const, post: p })),
        ].sort(
          (a, b) =>
            (likedAtByKey.get(rowKey(b)) ?? "").localeCompare(
              likedAtByKey.get(rowKey(a)) ?? "",
            ),
        )
      : [];
  const listData: FeedRow[] =
    activeTab === "all"
      ? reviews.map((r) => ({ kind: "review" as const, review: r }))
      : likedEntries;
  const restaurantMap = activeTab === "likes" ? likedRestaurants : restaurants;

  const likesEmpty = likedReviews.length === 0 && likedPosts.length === 0;

  // Tab-specific loading state for the empty area
  const showLikesLoading =
    activeTab === "likes" && likedStatus === "loading" && likesEmpty;

  // Tab-specific error state. We surface these inline (the rest of the
  // profile keeps rendering) because the tabs are independently loadable.
  const showLikesError =
    activeTab === "likes" && likedStatus === "error" && likesEmpty;
  const showListsLoading =
    activeTab === "lists" && listsStatus === "loading" && lists.length === 0;
  const showListsError =
    activeTab === "lists" && listsStatus === "error" && lists.length === 0;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={listData}
        keyExtractor={rowKey}
        renderItem={({ item }) =>
          item.kind === "review" ? (
            <UserReviewItem
              review={item.review}
              restaurant={restaurantMap.get(item.review.restaurantId) ?? null}
              onPress={handleRestaurantPress}
              onPhotoTap={handlePhotoTap}
            />
          ) : (
            <LikedPostItem
              post={item.post}
              author={likedPostAuthors.get(item.post.userId) ?? null}
              onPress={handlePostPress}
              onPhotoTap={handlePhotoTap}
            />
          )
        }
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
              showLists={listsEnabled()}
            />
            {/* Breathing room so the first review card doesn't jam directly
                against the tab strip's bottom hairline. List separators only
                render BETWEEN items, never before the first. */}
            <View style={styles.tabsSpacer} />
          </>
        }
        ListEmptyComponent={
          showLikesLoading || showListsLoading ? (
            <View style={styles.tabLoader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : showLikesError ? (
            <ErrorState
              variant="inline"
              icon={CloudOff}
              title="Couldn't load likes"
              body="Tap to try again."
              onRetry={loadLikes}
            />
          ) : showListsError ? (
            <ErrorState
              variant="inline"
              icon={CloudOff}
              title="Couldn't load collections"
              body="Tap to try again."
              onRetry={loadLists}
            />
          ) : activeTab === "lists" ? (
            lists.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <Library size={30} color={colors.textPrimary} strokeWidth={1.8} />
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
                    <Plus size={17} color={colors.onPrimary} strokeWidth={2.2} />
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
                    <CirclePlus size={21} color={colors.primary} strokeWidth={2} />
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
                <MessageSquareText
                  size={30}
                  color={colors.textPrimary}
                  strokeWidth={1.8}
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
                <Heart size={30} color={colors.textPrimary} strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>
                {isOwn ? "No likes yet" : "No likes"}
              </Text>
              <Text style={styles.emptyBody}>
                {isOwn
                  ? "Reviews and posts you like will appear here."
                  : `${user.displayName} hasn't liked anything yet.`}
              </Text>
            </View>
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

      <PhotoViewer
        photos={activePhotoSet.map(getImageViewUrl)}
        index={activePhotoIndex}
        onClose={() => setActivePhotoIndex(null)}
      />
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
    color: colors.onPrimary,
  },
  footerLoader: { paddingVertical: spacing.lg },
  tabLoader: { paddingVertical: spacing.huge, alignItems: "center" },
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
    color: colors.onPrimary,
  },
  });
}

