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
//
// Blocking (mutual): blocked users' reviews are filtered out client-side
// using getHiddenUserIds() (the union of "I blocked" + "blocked me"). The
// per-review ⋯ menu also offers Block for other people's reviews, which
// hides their content immediately and persists via the blocks service.
//
// Visual: flat feed on a single white surface — no card chrome (no shadow,
// no rounded corners, no border). Reviews are separated by a hairline, like
// Twitter/Instagram. The cleaner look came once we removed the gray page
// background from Home; bordered tiles on a same-color background read as
// noise.
//
// Failure UX:
//   When the initial load fails, we surface ErrorState with retry rather
//   than silently showing an empty feed. Pagination failures stay silent
//   (Sentry-only) since the first page already rendered and the user can
//   pull-to-refresh if it bothers them. Errors are tagged with the
//   feed-tab so the Sentry dashboard can show which tab is failing more.

import { Image } from "expo-image";
import * as Location from "expo-location";
import {
  Bell,
  Bookmark,
  CircleUserRound,
  CloudOff,
  CircleX,
  Ellipsis,
  Feather,
  Flag,
  Heart,
  LogOut,
  MapPin,
  MessageCircle,
  Search,
  Settings,
  Share2,
  ShieldUser,
  Star,
  Trash2,
  Users,
  UserX,
  UtensilsCrossed,
  X,
} from "lucide-react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { CommunityDrawer } from "@/components/CommunityDrawer";
import { DraggableSheet } from "@/components/DraggableSheet";
import { ErrorState } from "@/components/ErrorState";
import { PhotoViewer } from "@/components/PhotoViewer";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/Skeleton";
import { PAID_FEATURES_ENABLED } from "@/constants/features";
import { useAuth } from "@/hooks/useAuth";
import { blockUser, getHiddenUserIds } from "@/services/blocks";
import { getFollowCounts, getFollowingIds } from "@/services/follows";
import {
  getPostCommentCounts,
} from "@/services/postComments";
import {
  getLikedPostIds,
  getPostLikeCounts,
  likePost,
  postLikesEnabled,
  unlikePost,
} from "@/services/postLikes";
import {
  deletePost,
  listLatestPosts,
  listPostsByFollowing,
  postsEnabled,
} from "@/services/posts";
import { postReportsEnabled, reportPost, reportReview } from "@/services/reports";
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
import { captureError } from "@/services/sentry";
import { getImageViewUrl } from "@/services/storage";
import { getTastePreferences } from "@/services/userPreferences";
import { getUsersByIds } from "@/services/users";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Post } from "@/types/post";
import type { Parish, Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";
import { rankForYou, type RankingContext } from "@/utils/forYouRanking";

const BATCH_SIZE = 50;
const FOLLOWING_BATCH = 20;

type FeedTab = "following" | "for_you";

interface FeedItem {
  review: Review;
  author: User | null;
  restaurant: Restaurant | null;
}

/** A hydrated community post (non-review) for the feed. */
interface PostItem {
  post: Post;
  author: User | null;
  likeCount: number;
  commentCount: number;
  liked: boolean;
}

/** One feed row — either a review or a plain post. */
type FeedEntry =
  | ({ kind: "review" } & FeedItem)
  | ({ kind: "post" } & PostItem);

function entryCreatedAt(e: FeedEntry): string {
  return e.kind === "review" ? e.review.createdAt : e.post.createdAt;
}

/**
 * Merge reviews + posts into one feed.
 *  - "chrono": strict newest-first (Following — both sources are chronological).
 *  - "weave":  keep the ranked review order and slot posts (newest first) in
 *              every few rows (For You — re-sorting by date would erase the
 *              personalization ranking).
 */
function mergeFeed(
  reviews: FeedItem[],
  posts: PostItem[],
  mode: "chrono" | "weave",
): FeedEntry[] {
  const reviewEntries: FeedEntry[] = reviews.map((r) => ({
    kind: "review",
    ...r,
  }));
  const postEntries: FeedEntry[] = posts.map((p) => ({ kind: "post", ...p }));

  if (mode === "chrono") {
    return [...reviewEntries, ...postEntries].sort((a, b) =>
      entryCreatedAt(a) < entryCreatedAt(b) ? 1 : -1,
    );
  }

  // Weave: a post after every 3rd review, leftovers appended at the end.
  const GAP = 3;
  const out: FeedEntry[] = [];
  let pi = 0;
  for (let ri = 0; ri < reviewEntries.length; ri++) {
    out.push(reviewEntries[ri]);
    if ((ri + 1) % GAP === 0 && pi < postEntries.length) {
      out.push(postEntries[pi++]);
    }
  }
  while (pi < postEntries.length) out.push(postEntries[pi++]);
  return out;
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
  /**
   * Set when the initial load (or refresh) failed and we have no items
   * to show. Cleared on successful load or retry. Pagination failures
   * do not set this — they're surfaced only via Sentry to avoid an
   * error UI flashing after the user has scrolled past the first page.
   */
  error: Error | null;
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
  error: null,
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

// ─── Skeleton card — matches the flat layout (no card chrome) ───────────────
// Avatar + name/handle row, restaurant tag, stars, 3 text lines, photo
// block, footer with three action placeholders. Same paddings as the real
// flat row so the swap is seamless.

function CommunityCardSkeleton() {
  const { styles: cardStyles } = useThemedStyles(makeCardStyles);
  return (
    <View style={cardStyles.card}>
      {/* Author row */}
      <View style={cardStyles.authorRow}>
        <View style={cardStyles.authorInfo}>
          <SkeletonCircle size={42} />
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton width="55%" height={14} borderRadius={4} />
            <Skeleton width="40%" height={11} borderRadius={4} />
          </View>
        </View>
        <Skeleton width={32} height={32} borderRadius={radius.full} />
      </View>

      {/* Restaurant tag */}
      <Skeleton
        width={180}
        height={26}
        borderRadius={radius.lg}
        style={{ marginBottom: spacing.md }}
      />

      {/* Stars */}
      <Skeleton
        width={90}
        height={14}
        borderRadius={4}
        style={{ marginBottom: spacing.md }}
      />

      {/* Comment */}
      <View style={{ marginBottom: spacing.md }}>
        <SkeletonText lines={3} lineHeight={14} gap={8} lastLineWidthPct={55} />
      </View>

      {/* Photo */}
      <Skeleton
        width="100%"
        height={180}
        borderRadius={radius.lg}
        style={{ marginBottom: spacing.md }}
      />

      {/* Footer */}
      <View style={cardStyles.footer}>
        <Skeleton width={40} height={14} borderRadius={4} />
        <Skeleton width={40} height={14} borderRadius={4} />
        <Skeleton width={24} height={14} borderRadius={4} />
      </View>
    </View>
  );
}

export default function CommunityScreen() {
  const router = useRouter();
  const { user, logout, isAdmin } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);
  const cardStyles = useThemedStyles(makeCardStyles).styles;
  const sheetStyles = useThemedStyles(makeSheetStyles).styles;

  // Avatar drawer + in-feed search.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const [followCounts, setFollowCounts] = useState({
    followerCount: 0,
    followingCount: 0,
  });

  const [activeTab, setActiveTab] = useState<FeedTab>("following");
  const [following, setFollowing] = useState<FeedState>(EMPTY_FEED);
  const [forYou, setForYou] = useState<FeedState>(EMPTY_FEED);
  // Non-review posts, per tab. Loaded alongside the review pages and
  // refreshed on every focus so a just-composed post shows up immediately.
  const [followingPosts, setFollowingPosts] = useState<PostItem[]>([]);
  const [latestPosts, setLatestPosts] = useState<PostItem[]>([]);
  const [reviewToManage, setReviewToManage] = useState<Review | null>(null);
  const [postToManage, setPostToManage] = useState<Post | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // User IDs to filter out of the feed — the mutual block set (people I
  // blocked + people who blocked me). Loaded on focus + refresh, and added
  // to optimistically when blocking from the ⋯ menu.
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
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

  const hydratePosts = useCallback(
    async (posts: Post[]): Promise<PostItem[]> => {
      if (posts.length === 0) return [];
      const ids = posts.map((p) => p.id);
      // Authors + like/comment counts + my-liked set, all in parallel. The
      // interaction helpers are tolerant (empty on failure), so a hiccup just
      // shows zero counts rather than breaking the feed.
      const [authors, likeCounts, commentCounts, likedIds] = await Promise.all([
        getUsersByIds(posts.map((p) => p.userId)),
        getPostLikeCounts(ids),
        getPostCommentCounts(ids),
        getLikedPostIds(ids),
      ]);
      return posts.map((post) => ({
        post,
        author: authors.get(post.userId) ?? null,
        likeCount: likeCounts.get(post.id) ?? 0,
        commentCount: commentCounts.get(post.id) ?? 0,
        liked: likedIds.has(post.id),
      }));
    },
    [],
  );

  // Fetch the post window for both tabs. Tolerant end to end (the posts
  // service returns empty pages on failure), so this can never error the
  // feed — worst case posts just don't appear. Runs on focus so a post
  // composed moments ago shows without a manual pull-to-refresh.
  const refreshPosts = useCallback(async () => {
    if (!postsEnabled()) return;
    const latest = await listLatestPosts();
    setLatestPosts(await hydratePosts(latest.items));
    if (user) {
      const followingIds = await getFollowingIds(user.id).catch(
        () => [] as string[],
      );
      const mine = await listPostsByFollowing(followingIds);
      // Your own posts belong in your Following feed too (X-style).
      const own = latest.items.filter(
        (p) => p.userId === user.id && !mine.items.some((m) => m.id === p.id),
      );
      setFollowingPosts(
        await hydratePosts(
          [...mine.items, ...own].sort((a, b) =>
            a.createdAt < b.createdAt ? 1 : -1,
          ),
        ),
      );
    }
  }, [user, hydratePosts]);

  const buildRankingContext = useCallback(async (): Promise<RankingContext> => {
    if (!user) {
      return {
        followedAuthorIds: new Set(),
        savedRestaurantIds: new Set(),
        userParish: null,
      };
    }

    const [followingIds, savedDocs, parish, taste] = await Promise.all([
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
      getTastePreferences().catch(() => ({
        favoriteCuisines: [] as string[],
        favoriteParishes: [] as Parish[],
      })),
    ]);

    return {
      followedAuthorIds: new Set(followingIds),
      savedRestaurantIds: new Set(savedDocs.map((d) => d.restaurantId)),
      userParish: parish,
      favoriteCuisines: new Set(
        taste.favoriteCuisines.map((c) => c.toLowerCase()),
      ),
      favoriteParishes: new Set(taste.favoriteParishes),
    };
  }, [user]);

  // Load the mutual block set. Tolerant (returns empty on failure), so no
  // try/catch needed — worst case the feed just isn't filtered.
  const loadBlocked = useCallback(async () => {
    const ids = await getHiddenUserIds();
    setBlockedUserIds(ids);
  }, []);

  const loadFollowing = useCallback(
    async (isRefresh = false) => {
      if (!user) return;
      setFollowing((prev) => ({
        ...prev,
        loading: !isRefresh,
        refreshing: isRefresh,
        error: null,
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
          error: null,
        });
        loaded.current.following = true;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        captureError(errorObj, {
          screen: "community",
          tab: "following",
          op: "loadFollowing",
        });
        setFollowing((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          // Only show error UI when there's nothing to fall back on. If
          // a refresh fails mid-session, keep the stale items visible
          // rather than wiping them.
          error: prev.items.length === 0 ? errorObj : prev.error,
        }));
      }
    },
    [user, hydrate],
  );

  const loadMoreFollowing = useCallback(async () => {
    if (!user || !following.hasMore || following.loadingMore) return;

    setFollowing((prev) => ({ ...prev, loadingMore: true }));
    try {
      const followingIds = await getFollowingIds(user.id);
      if (followingIds.length === 0) {
        setFollowing((prev) => ({ ...prev, loadingMore: false }));
        return;
      }

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
    } catch (err) {
      // Silent UI failure for pagination — Sentry-only. The first page
      // is already rendered; throwing an error UI here would wipe what
      // the user is already reading. They can pull-to-refresh if they
      // notice the feed stopped extending.
      captureError(err, {
        screen: "community",
        tab: "following",
        op: "loadMoreFollowing",
      });
      setFollowing((prev) => ({ ...prev, loadingMore: false }));
    }
  }, [user, following, hydrate]);

  const loadForYou = useCallback(
    async (isRefresh = false) => {
      setForYou((prev) => ({
        ...prev,
        loading: !isRefresh,
        refreshing: isRefresh,
        error: null,
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
          error: null,
        });
        loaded.current.for_you = true;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        captureError(errorObj, {
          screen: "community",
          tab: "for_you",
          op: "loadForYou",
        });
        setForYou((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: prev.items.length === 0 ? errorObj : prev.error,
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
    } catch (err) {
      // Same silent-UI policy as loadMoreFollowing.
      captureError(err, {
        screen: "community",
        tab: "for_you",
        op: "loadMoreForYou",
      });
      setForYou((prev) => ({ ...prev, loadingMore: false }));
    }
  }, [forYou, hydrate]);

  useFocusEffect(
    useCallback(() => {
      loadBlocked();
      // Posts are cheap (one or two list calls) — refresh every focus so a
      // post composed in the modal shows the moment you land back here.
      refreshPosts();
      if (!loaded.current.following) loadFollowing();
      if (!loaded.current.for_you) loadForYou();
    }, [loadBlocked, refreshPosts, loadFollowing, loadForYou]),
  );

  const handleRefresh = useCallback(() => {
    loaded.current[activeTab] = false;
    loadBlocked();
    refreshPosts();
    if (activeTab === "following") loadFollowing(true);
    else loadForYou(true);
  }, [activeTab, loadBlocked, refreshPosts, loadFollowing, loadForYou]);

  const handleRetry = useCallback(() => {
    if (activeTab === "following") loadFollowing(false);
    else loadForYou(false);
  }, [activeTab, loadFollowing, loadForYou]);

  // Tracks review ids whose like toggle is mid-request, so re-entrant taps drop.
  const likeInFlight = useRef<Set<string>>(new Set());

  const handleToggleLike = useCallback(
    async (reviewId: string, restaurantId: string, currentlyLiked: boolean) => {
      // Per-review in-flight guard: a fast double-tap on one heart would
      // otherwise fire like+unlike as two racing requests. Keyed by reviewId, so
      // other reviews are unaffected. Ref → re-entry is blocked synchronously.
      if (likeInFlight.current.has(reviewId)) return;
      likeInFlight.current.add(reviewId);

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
      } catch (err) {
        // Service already reported to Sentry — we just revert the
        // optimistic state. No alert: a brief flicker is less annoying
        // than a popup for a heart icon.
        captureError(err, {
          screen: "community",
          op: "toggleLike",
          reviewId,
        });
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
      } finally {
        likeInFlight.current.delete(reviewId);
      }
    },
    [activeTab],
  );

  // Per-post in-flight guard for the like toggle (same rationale as reviews).
  const postLikeInFlight = useRef<Set<string>>(new Set());

  // Toggle like on a plain post. Updates both post lists optimistically so the
  // heart + count react instantly regardless of which tab it lives in; reverts
  // on failure. Own posts can't be liked (guarded in the card too).
  const handleTogglePostLike = useCallback(
    async (postId: string, currentlyLiked: boolean) => {
      if (!postLikesEnabled() || postLikeInFlight.current.has(postId)) return;
      postLikeInFlight.current.add(postId);

      const apply = (like: boolean) => {
        const patch = (p: PostItem): PostItem =>
          p.post.id === postId
            ? {
                ...p,
                liked: like,
                likeCount: Math.max(0, p.likeCount + (like ? 1 : -1)),
              }
            : p;
        setFollowingPosts((prev) => prev.map(patch));
        setLatestPosts((prev) => prev.map(patch));
      };

      apply(!currentlyLiked);
      try {
        if (currentlyLiked) await unlikePost(postId);
        else await likePost(postId);
      } catch (err) {
        apply(currentlyLiked); // revert
        captureError(err, { screen: "community", op: "togglePostLike", postId });
      } finally {
        postLikeInFlight.current.delete(postId);
      }
    },
    [],
  );

  // Native share sheet, text-only message
  const handleShare = useCallback(async (item: FeedItem) => {
    try {
      await Share.share({
        message: buildShareMessage(item),
      });
    } catch (err) {
      // Share sheet failures are usually "user dismissed" — don't report
      // unless this becomes a real signal. Keep noisy-but-cheap log only.
      console.warn("[community] share failed:", err);
    }
  }, []);

  const handleDeletePost = useCallback(async (post: Post) => {
    try {
      await deletePost(post.id);
      setFollowingPosts((prev) => prev.filter((p) => p.post.id !== post.id));
      setLatestPosts((prev) => prev.filter((p) => p.post.id !== post.id));
    } catch (err) {
      captureError(err, {
        screen: "community",
        op: "deletePost",
        postId: post.id,
      });
      Alert.alert(
        "Couldn't delete",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const handleSharePost = useCallback(async (item: PostItem) => {
    try {
      await Share.share({
        message: `${item.author?.displayName ?? "Someone"} on Hidden Plate:\n\n"${item.post.text}"`,
      });
    } catch (err) {
      console.warn("[community] share post failed:", err);
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
      captureError(err, {
        screen: "community",
        op: "deleteReview",
        reviewId: review.id,
      });
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
    } catch (err) {
      // Roll back the optimistic hide so the review reappears, and let
      // the user know it didn't actually file.
      setHiddenIds((p) => {
        const next = new Set(p);
        next.delete(review.id);
        return next;
      });
      captureError(err, {
        screen: "community",
        op: "reportReview",
        reviewId: review.id,
      });
      Alert.alert(
        "Couldn't report",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  }, []);

  // Report a post. Same optimistic-hide pattern as reviews: hide it from the
  // feed immediately (via hiddenIds), file the report, revert on failure.
  const handleReportPost = useCallback(async (post: Post) => {
    setHiddenIds((p) => new Set(p).add(post.id));
    setPostToManage(null);
    try {
      await reportPost(post.id, "inappropriate");
      Alert.alert("Reported", "Thank you for keeping our community safe.");
    } catch (err) {
      setHiddenIds((p) => {
        const next = new Set(p);
        next.delete(post.id);
        return next;
      });
      captureError(err, {
        screen: "community",
        op: "reportPost",
        postId: post.id,
      });
      Alert.alert(
        "Couldn't report",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  }, []);

  // Block the author of a review. Optimistic: add to blockedUserIds so all
  // of their content disappears from the feed immediately; revert on error.
  const handleBlockAuthor = useCallback(async (review: Review) => {
    const targetId = review.userId;
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
        screen: "community",
        op: "blockAuthor",
        targetUserId: targetId,
      });
      Alert.alert(
        "Couldn't block",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const currentFeed = activeTab === "following" ? following : forYou;
  const visibleItems = currentFeed.items.filter(
    (i) => !hiddenIds.has(i.review.id) && !blockedUserIds.has(i.review.userId),
  );

  // Posts for the active tab, minus blocked authors and reported/hidden posts.
  const currentPosts = (
    activeTab === "following" ? followingPosts : latestPosts
  ).filter(
    (p) => !blockedUserIds.has(p.post.userId) && !hiddenIds.has(p.post.id),
  );

  // One merged feed of reviews + posts. Following is strictly chronological;
  // For You keeps the ranked review order and weaves posts in.
  const mergedEntries = mergeFeed(
    visibleItems,
    currentPosts,
    activeTab === "following" ? "chrono" : "weave",
  );

  // In-feed search: filters the loaded entries by the poster (name/handle),
  // the restaurant name, and the review/post text. Empty query = full feed.
  const searchTerm = searchQuery.trim().toLowerCase();
  const searching = searchOpen && searchTerm.length > 0;
  const displayedItems = searching
    ? mergedEntries.filter((e) => {
        const authorHit =
          !!e.author?.displayName?.toLowerCase().includes(searchTerm) ||
          !!e.author?.username?.toLowerCase().includes(searchTerm);
        if (e.kind === "post") {
          return authorHit || e.post.text.toLowerCase().includes(searchTerm);
        }
        return (
          authorHit ||
          !!e.restaurant?.name?.toLowerCase().includes(searchTerm) ||
          !!e.review.comment?.toLowerCase().includes(searchTerm)
        );
      })
    : mergedEntries;

  const handleToggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        setSearchQuery("");
      }
      return next;
    });
  }, []);

  const handleLogout = useCallback(() => {
    setDrawerOpen(false);
    Alert.alert(
      "Sign out?",
      "You'll need to sign in again to use Hidden Plate.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            try {
              await logout();
            } catch (err) {
              Alert.alert(
                "Sign out failed",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ],
    );
  }, [logout]);

  const handleOpenDrawer = useCallback(() => {
    setDrawerOpen(true);
    // Refresh follow counts each time the drawer opens (best-effort).
    if (user?.id) {
      getFollowCounts(user.id)
        .then(setFollowCounts)
        .catch(() => {});
    }
  }, [user?.id]);

  const handlePremium = useCallback(() => {
    setDrawerOpen(false);
    Alert.alert(
      "Hidden Plate Premium",
      "Premium unlocks more features — coming soon!",
    );
  }, []);

  // Author of the review currently open in the manage sheet (for the Block
  // label + confirm copy). The managed review came from the active tab.
  const manageAuthor =
    reviewToManage != null
      ? (currentFeed.items.find((i) => i.review.id === reviewToManage.id)
          ?.author ?? null)
      : null;

  // Same lookup for the post manage sheet.
  const managePostAuthor =
    postToManage != null
      ? (currentPosts.find((p) => p.post.id === postToManage.id)?.author ??
        null)
      : null;

  const renderItem = useCallback(
    ({ item, index }: { item: FeedEntry; index: number }) => {
      // ── Plain post card — same chrome as a review, minus stars +
      //    restaurant tag. Tapping the card opens the post thread; the footer
      //    has Like · Comment · Share backed by the postLikes/postComments
      //    collections.
      if (item.kind === "post") {
        const { post, author, liked, likeCount, commentCount } = item;
        const isOwnPost = user?.id === post.userId;
        return (
          <Animated.View
            entering={FadeInDown.delay(Math.min(index, 5) * 60).springify()}
          >
            <Pressable
              style={({ pressed }) => [
                cardStyles.card,
                pressed && cardStyles.cardPressed,
              ]}
              onPress={() =>
                // Typed-routes union regenerates on dev-server start; this
                // freshly-added route isn't in it yet — the route exists.
                router.push(`/post/${post.id}` as unknown as Href)
              }
              accessibilityRole="button"
            >
              <View style={cardStyles.authorRow}>
                <Pressable
                  style={cardStyles.authorInfo}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    router.push(`/profile/${post.userId}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${author?.displayName ?? "user"}'s profile`}
                >
                  <AuthorAvatar author={author} userId={post.userId} />
                  <View style={cardStyles.authorText}>
                    <Text style={cardStyles.authorName} numberOfLines={1}>
                      {author?.displayName ?? "Hidden Plate user"}
                    </Text>
                    <Text style={cardStyles.authorHandle}>
                      {author?.username ? `@${author.username} · ` : ""}
                      {formatTimeAgo(post.createdAt)}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setPostToManage(post);
                  }}
                  hitSlop={8}
                  style={cardStyles.moreBtn}
                  accessibilityRole="button"
                  accessibilityLabel="More options"
                >
                  <Ellipsis size={18} color={colors.textMuted} strokeWidth={2} />
                </Pressable>
              </View>

              <Text style={cardStyles.postText}>{post.text}</Text>

              {post.imageIds.length > 0 ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setActivePhotoSet(post.imageIds);
                    setActivePhotoIndex(0);
                  }}
                  style={cardStyles.photoWrap}
                >
                  <Image
                    source={{ uri: getImageViewUrl(post.imageIds[0]) }}
                    style={cardStyles.photo}
                    contentFit="cover"
                    transition={250}
                    cachePolicy="memory-disk"
                  />
                  {post.imageIds.length > 1 ? (
                    <View style={cardStyles.photoBadge}>
                      <Text style={cardStyles.photoBadgeText}>
                        +{post.imageIds.length - 1}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}

              <View style={cardStyles.footer}>
                {postLikesEnabled() ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleTogglePostLike(post.id, liked);
                    }}
                    disabled={isOwnPost}
                    style={({ pressed }) => [
                      cardStyles.actionBtn,
                      pressed && { opacity: 0.6 },
                      isOwnPost && { opacity: 0.4 },
                    ]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={liked ? "Unlike" : "Like"}
                  >
                    <Heart
                      size={19}
                      color={liked ? colors.primary : colors.textMuted}
                      fill={liked ? colors.primary : "transparent"}
                      strokeWidth={2}
                    />
                    <Text
                      style={[
                        cardStyles.actionCount,
                        liked && cardStyles.actionCountActive,
                      ]}
                    >
                      {likeCount}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    router.push(`/post/${post.id}` as unknown as Href);
                  }}
                  style={({ pressed }) => [
                    cardStyles.actionBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="View comments"
                >
                  <MessageCircle
                    size={18}
                    color={colors.textMuted}
                    strokeWidth={2}
                  />
                  <Text style={cardStyles.actionCount}>{commentCount}</Text>
                </Pressable>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleSharePost(item);
                  }}
                  style={({ pressed }) => [
                    cardStyles.actionBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Share"
                >
                  <Share2 size={18} color={colors.textMuted} strokeWidth={2} />
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        );
      }

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
                <Ellipsis size={18} color={colors.textMuted} strokeWidth={2} />
              </Pressable>
            </View>

            <Pressable
              style={cardStyles.restaurantTag}
              onPress={(e) => {
                e.stopPropagation?.();
                router.push(`/restaurant/${review.restaurantId}`);
              }}
            >
              <MapPin size={12} color={colors.textSecondary} strokeWidth={2.2} />
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
                <Star
                  key={i}
                  size={14}
                  color={i <= review.rating ? colors.star : colors.border}
                  fill={i <= review.rating ? colors.star : "transparent"}
                  strokeWidth={2}
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
                <Heart
                  size={19}
                  color={isLiked ? colors.primary : colors.textMuted}
                  fill={isLiked ? colors.primary : "transparent"}
                  strokeWidth={2}
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
                <MessageCircle
                  size={18}
                  color={colors.textMuted}
                  strokeWidth={2}
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
                <Share2 size={18} color={colors.textMuted} strokeWidth={2} />
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [
      currentFeed.likedIds,
      user,
      handleToggleLike,
      handleTogglePostLike,
      handleShare,
      handleSharePost,
      router,
      cardStyles,
      colors,
    ],
  );

  const tabs = [
    { id: "following" as const, label: "Following" },
    { id: "for_you" as const, label: "For You" },
  ];

  // Render selector — error state takes priority over loading and feed.
  // We only show the error state when there's nothing to fall back on;
  // a refresh failure with stale items present keeps the items visible.
  const showError =
    !currentFeed.loading && currentFeed.error && currentFeed.items.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Animated.View entering={FadeIn.duration(400)} style={styles.header}>
        <Pressable
          onPress={handleOpenDrawer}
          style={styles.headerSide}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Avatar
            fileId={user?.avatarUrl}
            displayName={user?.displayName ?? ""}
            userId={user?.id ?? ""}
            size={36}
          />
        </Pressable>

        <Text style={styles.title}>Community</Text>

        <Pressable
          onPress={handleToggleSearch}
          style={[styles.headerSide, styles.headerRight]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? "Close search" : "Search"}
        >
          {searchOpen ? (
            <X size={22} color={colors.textPrimary} strokeWidth={2.2} />
          ) : (
            <Search size={22} color={colors.textPrimary} strokeWidth={2.2} />
          )}
        </Pressable>
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

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <View style={styles.searchBar}>
            <Search
              size={19}
              color={colors.textSecondary}
              strokeWidth={2.2}
              style={{ marginRight: spacing.sm }}
            />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search people, places, posts…"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              autoCapitalize="none"
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <CircleX size={17} color={colors.textMuted} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {showError ? (
        <ErrorState
          variant="screen"
          icon={CloudOff}
          title="Couldn't load the feed"
          body="Check your connection and try again."
          onRetry={handleRetry}
        />
      ) : currentFeed.loading ? (
        // Skeleton list — mimics 4 feed rows with the same hairline gaps as
        // the real list. No ActivityIndicator, no "Loading feed…" text.
        <View style={styles.skeletonList}>
          <CommunityCardSkeleton />
          <View style={styles.itemDivider} />
          <CommunityCardSkeleton />
          <View style={styles.itemDivider} />
          <CommunityCardSkeleton />
          <View style={styles.itemDivider} />
          <CommunityCardSkeleton />
        </View>
      ) : (
        <FlatList
          data={displayedItems}
          keyExtractor={(item) =>
            item.kind === "post" ? `post-${item.post.id}` : item.review.id
          }
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={5}
          // Hairline divider between reviews — gives the flat layout a
          // clear "here's where one review ends and another starts" cue
          // without the heavy chrome of borders + shadows.
          ItemSeparatorComponent={() => <View style={styles.itemDivider} />}
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
            searching ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <Search
                    size={30}
                    color={colors.textPrimary}
                    strokeWidth={1.8}
                  />
                </View>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyBody}>
                  Nothing in your feed matches “{searchQuery.trim()}”.
                </Text>
              </View>
            ) : (
            <Animated.View
              entering={FadeInDown.springify()}
              style={styles.emptyContainer}
            >
              {activeTab === "following" && currentFeed.notFollowingAnyone ? (
                <>
                  <View style={styles.emptyIconWrap}>
                    <Users
                      size={30}
                      color={colors.textPrimary}
                      strokeWidth={1.8}
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
                    <UtensilsCrossed
                      size={30}
                      color={colors.textPrimary}
                      strokeWidth={1.8}
                    />
                  </View>
                  <Text style={styles.emptyTitle}>No reviews yet</Text>
                  <Text style={styles.emptyBody}>
                    Be the first to share a hidden gem!
                  </Text>
                </>
              )}
            </Animated.View>
            )
          }
        />
      )}

      <DraggableSheet
        visible={!!reviewToManage}
        onClose={() => setReviewToManage(null)}
      >
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
                <Trash2 size={20} color={colors.error} strokeWidth={2} />
                <Text style={[sheetStyles.itemText, { color: colors.error }]}>
                  Delete Review
                </Text>
              </Pressable>
            ) : (
              <>
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
                  <Flag size={20} color={colors.error} strokeWidth={2} />
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
                          onPress: () => r && handleBlockAuthor(r),
                        },
                      ],
                    );
                  }}
                >
                  <UserX size={20} color={colors.textPrimary} strokeWidth={2} />
                  <Text style={sheetStyles.itemText}>
                    {manageAuthor?.username
                      ? `Block @${manageAuthor.username}`
                      : "Block user"}
                  </Text>
                </Pressable>
              </>
            )}

        <Pressable
          style={sheetStyles.cancelBtn}
          onPress={() => setReviewToManage(null)}
        >
          <Text style={sheetStyles.cancelText}>Cancel</Text>
        </Pressable>
      </DraggableSheet>

      {/* Manage sheet for plain posts — delete your own, block other authors. */}
      <DraggableSheet
        visible={!!postToManage}
        onClose={() => setPostToManage(null)}
      >
        <Text style={sheetStyles.title}>Manage Post</Text>

        {postToManage?.userId === user?.id ? (
          <Pressable
            style={sheetStyles.item}
            onPress={() => {
              const p = postToManage;
              setPostToManage(null);
              Alert.alert("Delete Post?", "This can't be undone.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => p && handleDeletePost(p),
                },
              ]);
            }}
          >
            <Trash2 size={20} color={colors.error} strokeWidth={2} />
            <Text style={[sheetStyles.itemText, { color: colors.error }]}>
              Delete Post
            </Text>
          </Pressable>
        ) : (
          <>
            {postReportsEnabled() ? (
              <Pressable
                style={sheetStyles.item}
                onPress={() => {
                  const p = postToManage;
                  setPostToManage(null);
                  Alert.alert("Report Post", "Report this as inappropriate?", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Report",
                      style: "destructive",
                      onPress: () => p && handleReportPost(p),
                    },
                  ]);
                }}
              >
                <Flag size={20} color={colors.error} strokeWidth={2} />
                <Text style={[sheetStyles.itemText, { color: colors.error }]}>
                  Report as Inappropriate
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={sheetStyles.item}
              onPress={() => {
                const p = postToManage;
                const uname = managePostAuthor?.username;
                setPostToManage(null);
                Alert.alert(
                  "Block user",
                  uname
                    ? `Block @${uname}? You won't see each other's posts or reviews.`
                    : "Block this user? You won't see each other's posts or reviews.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Block",
                      style: "destructive",
                      onPress: () => {
                        if (!p) return;
                        setBlockedUserIds((prev) => new Set(prev).add(p.userId));
                        blockUser(p.userId).catch((err) => {
                          setBlockedUserIds((prev) => {
                            const next = new Set(prev);
                            next.delete(p.userId);
                            return next;
                          });
                          captureError(err, {
                            screen: "community",
                            op: "blockPostAuthor",
                            targetUserId: p.userId,
                          });
                          Alert.alert(
                            "Couldn't block",
                            err instanceof Error ? err.message : "Try again.",
                          );
                        });
                      },
                    },
                  ],
                );
              }}
            >
              <UserX size={20} color={colors.textPrimary} strokeWidth={2} />
              <Text style={sheetStyles.itemText}>
                {managePostAuthor?.username
                  ? `Block @${managePostAuthor.username}`
                  : "Block user"}
              </Text>
            </Pressable>
          </>
        )}

        <Pressable
          style={sheetStyles.cancelBtn}
          onPress={() => setPostToManage(null)}
        >
          <Text style={sheetStyles.cancelText}>Cancel</Text>
        </Pressable>
      </DraggableSheet>

      {/* Compose FAB — X-style floating button (hidden when posting is off). */}
      {postsEnabled() ? (
        <Pressable
          onPress={() => router.push("/compose-post")}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          accessibilityRole="button"
          accessibilityLabel="Write a post"
        >
          <Feather size={22} color={colors.white} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      <PhotoViewer
        photos={activePhotoSet.map(getImageViewUrl)}
        index={activePhotoIndex}
        onClose={() => setActivePhotoIndex(null)}
      />

      <CommunityDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        follow={followCounts}
        onProfilePress={() => {
          setDrawerOpen(false);
          router.push("/(tabs)/profile");
        }}
        onFollowingPress={() => {
          setDrawerOpen(false);
          if (user?.id) {
            router.push({
              pathname: "/follows/[type]",
              params: { type: "following", userId: user.id },
            });
          }
        }}
        onFollowersPress={() => {
          setDrawerOpen(false);
          if (user?.id) {
            router.push({
              pathname: "/follows/[type]",
              params: { type: "followers", userId: user.id },
            });
          }
        }}
        onPremiumPress={PAID_FEATURES_ENABLED ? handlePremium : undefined}
        items={[
          ...(isAdmin
            ? [
                {
                  icon: ShieldUser,
                  label: "Admin",
                  onPress: () => {
                    setDrawerOpen(false);
                    router.push("/admin");
                  },
                },
              ]
            : []),
          {
            icon: CircleUserRound,
            label: "My Profile",
            onPress: () => {
              setDrawerOpen(false);
              router.push("/(tabs)/profile");
            },
          },
          {
            icon: Bookmark,
            label: "Saved",
            onPress: () => {
              setDrawerOpen(false);
              router.push("/(tabs)/saved");
            },
          },
          {
            icon: Bell,
            label: "Notifications",
            onPress: () => {
              setDrawerOpen(false);
              router.push("/notifications");
            },
          },
          {
            icon: Settings,
            label: "Settings",
            onPress: () => {
              setDrawerOpen(false);
              router.push("/settings");
            },
          },
        ]}
        footer={{
          icon: LogOut,
          label: "Log Out",
          danger: true,
          onPress: handleLogout,
        }}
      />
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
  return (
    <Avatar
      fileId={author?.avatarUrl}
      displayName={author?.displayName ?? "Hidden Plate user"}
      userId={userId}
      size={42}
    />
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Fixed-width left/right gutters so the centered title stays optically
  // centered regardless of the avatar vs. icon widths.
  headerSide: {
    width: 40,
    justifyContent: "center",
  },
  headerRight: {
    alignItems: "flex-end",
  },
  title: {
    flex: 1,
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    textAlign: "center",
  },
  searchWrap: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    padding: 0,
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
  // No top padding — the first review row's own padding gives it room.
  listContent: { paddingBottom: 100 },
  // Matches the FlatList layout (no top padding) so the skeleton sits in
  // the exact position the first real card will.
  skeletonList: {
    flex: 1,
    backgroundColor: colors.cardBackground,
  },
  // Hairline between rows. Same colour as the tab-bar bottom divider so the
  // page reads as one consistent piece of vertical typography.
  itemDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
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
    backgroundColor: colors.surface,
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
  // X-style compose FAB, floating above the feed's bottom-right corner.
  fab: {
    position: "absolute",
    right: spacing.screen,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.md,
  },
  fabPressed: { backgroundColor: colors.accentDark },
  });
}

function makeCardStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Flat row — no shadow, no border, no rounded corners, no horizontal
  // margin. The hairline ItemSeparatorComponent does the visual splitting
  // between rows. Horizontal padding lives here so the content respects
  // the screen edge inset.
  card: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.lg,
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
  // Quiet neutral chip — a filled surface pill (no border) so the ink
  // palette doesn't render it as a heavy outlined box.
  restaurantTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginBottom: spacing.md,
    gap: 5,
  },
  restaurantTagText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  restaurantTagBold: {
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  restaurantTagParish: {
    fontFamily: fonts.regular,
    color: colors.textMuted,
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
  // Plain-post body — a touch larger than review comments, X-style.
  postText: {
    fontFamily: fonts.regular,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    lineHeight: 24,
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
  // Actions row (like / comment). No top hairline — under a post image it
  // read as a stray separator between the photo and the buttons.
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    paddingTop: spacing.md,
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
}

function makeSheetStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Sheet chrome (backdrop, rounded sheet, drag handle) now lives in
  // DraggableSheet; only the inner content styles remain here.
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
}

