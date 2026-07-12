// app/review/[id].tsx
// Dedicated review + comment thread screen.
//
// Layout:
//   ← header
//   Review post (author, stars, text, photos)
//   Comments header
//   Comment list
//   Input bar
//
// Note: realtime subscription (live new comments + live like count) was
// deferred — needs AsyncStorage native-linked, requires fresh EAS APK
// installed on a clean device. Once that's installed, paste back the
// realtime useEffect from the chat history. Until then, comments you
// post appear immediately (optimistic), but other users' new comments
// won't show until you re-enter the screen.
//
// Loading state: skeleton mirrors the real layout (author row, restaurant
// tag, stars, comment, photo placeholder, comments header) followed by 3
// comment-row skeletons. The back button stays live so the user isn't
// trapped while the screen loads.
//
// Failure handling:
//   - The primary fetch (the review itself) is tolerant in the service —
//     getReviewById returns null both for "not found" AND "fetch failed".
//     To distinguish, we track loadError separately and prefer "couldn't
//     load" UI when the fetch threw, vs "review not found" when it
//     genuinely returned null.
//   - Comments / authors / restaurant load failures are absorbed — the
//     review block still renders, just with fewer commenters or no
//     restaurant tag. Comments empty out on failure (Sentry captures it).

import {
  ArrowLeft,
  Ban,
  CloudOff,
  Ellipsis,
  MapPin,
  MessageCircleQuestion,
  Send,
  Star,
  Trash2,
} from "lucide-react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { ErrorState } from "@/components/ErrorState";
import { OwnerReviewResponse } from "@/components/OwnerReviewResponse";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { blockUser, getHiddenUserIds } from "@/services/blocks";
import { commentReportsEnabled, reportComment } from "@/services/reports";
import { getRestaurantById } from "@/services/restaurants";
import {
  addComment,
  deleteComment,
  listCommentsForReview,
} from "@/services/reviewComments";
import { getReviewById } from "@/services/reviews";
import { captureError } from "@/services/sentry";
import { getImageViewUrl } from "@/services/storage";
import { getUsersByIds } from "@/services/users";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { ReviewComment } from "@/types/reviewComment";
import type { User } from "@/types/user";

const { width: SW } = Dimensions.get("window");

interface CommentWithAuthor {
  comment: ReviewComment;
  author: User | null;
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

export default function ReviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);
  const skeletonStyles = useThemedStyles(makeSkeletonStyles).styles;

  const [review, setReview] = useState<Review | null>(null);
  const [author, setAuthor] = useState<User | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  // True when the primary fetch hit a real error (not "not found").
  // Used to show "Couldn't load" instead of "Review not found".
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Mutual block set — hides a blocked author's review and their comments.
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());

  // Bottom safe-area inset so the comment composer sits above the device nav
  // bar / home indicator instead of flush against the screen edge.
  const insets = useSafeAreaInsets();

  // Whether the keyboard is up — collapses the composer's nav inset while
  // typing (it rides above the keyboard via KeyboardAvoidingView, so the inset
  // would just add a gap then). Restored when the keyboard hides.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const listRef = useRef<FlatList>(null);

  // ─── Initial load ──────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadFailed(false);

    // Step 1 — fetch the review. getReviewById is tolerant: returns null on
    // both "not found" AND fetch failure. We can't distinguish those without
    // probing the network state. As a heuristic, we treat a failure of any
    // SECONDARY fetch (which all hit the same endpoint moments later) as
    // signal that the network is what failed — but the simpler approach is
    // to wrap the getReviewById call in its own try/catch with a custom
    // throwing helper. Skipping that complexity: if getReviewById returned
    // null AND the user-by-ID call also threw, that's the network. We just
    // bucket those together as "load failed" rather than building a smarter
    // distinguisher.
    let fetchedReview: Review | null;
    try {
      fetchedReview = await getReviewById(id);
    } catch (err) {
      // Shouldn't happen because getReviewById doesn't throw — but defensive.
      captureError(err, {
        screen: "reviewDetail",
        op: "load.getReviewById",
        reviewId: id,
      });
      setLoadFailed(true);
      setLoading(false);
      return;
    }

    if (!fetchedReview) {
      // Could be "not found" OR a silent fetch error. Show "not found"
      // UI; users hitting a network error here will see it as missing.
      // Not ideal but the simpler trade-off given the service signature.
      setReview(null);
      setLoading(false);
      return;
    }

    setReview(fetchedReview);

    // Step 2 — secondary fetches in parallel. allSettled so a failure in
    // one section doesn't kill the others.
    const [
      authorMapResult,
      restaurantResult,
      commentsPageResult,
      hiddenResult,
    ] = await Promise.allSettled([
      getUsersByIds([fetchedReview.userId]),
      getRestaurantById(fetchedReview.restaurantId),
      listCommentsForReview(id, { pageSize: 100 }),
      getHiddenUserIds(),
    ]);

    // Mutual block set — hides a blocked author's review entirely (handled in
    // render) and filters blocked users' comments below. Tolerant: empty set
    // on failure means nothing is filtered rather than the screen breaking.
    const hidden =
      hiddenResult.status === "fulfilled"
        ? hiddenResult.value
        : new Set<string>();
    setBlockedUserIds(hidden);

    // Author of the review
    if (authorMapResult.status === "fulfilled") {
      setAuthor(authorMapResult.value.get(fetchedReview.userId) ?? null);
    } else {
      captureError(authorMapResult.reason, {
        screen: "reviewDetail",
        op: "load.getUsersByIds.author",
        reviewId: id,
      });
      setAuthor(null);
    }

    // Restaurant tag — null on failure is fine; the tag won't render
    if (restaurantResult.status === "fulfilled") {
      setRestaurant(restaurantResult.value);
    } else {
      captureError(restaurantResult.reason, {
        screen: "reviewDetail",
        op: "load.getRestaurantById",
        restaurantId: fetchedReview.restaurantId,
      });
      setRestaurant(null);
    }

    // Comments + their commenters
    if (commentsPageResult.status === "fulfilled") {
      const commentsPage = commentsPageResult.value;
      const commenterIds = Array.from(
        new Set(commentsPage.items.map((c) => c.userId)),
      );
      let commenterMap = new Map<string, User>();
      if (commenterIds.length > 0) {
        try {
          commenterMap = await getUsersByIds(commenterIds);
        } catch (err) {
          captureError(err, {
            screen: "reviewDetail",
            op: "load.getUsersByIds.commenters",
            reviewId: id,
          });
        }
      }
      setComments(
        commentsPage.items
          .filter((c) => !hidden.has(c.userId))
          .map((c) => ({
            comment: c,
            author: commenterMap.get(c.userId) ?? null,
          })),
      );
    } else {
      captureError(commentsPageResult.reason, {
        screen: "reviewDetail",
        op: "load.listCommentsForReview",
        reviewId: id,
      });
      setComments([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ─── Send comment ──────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!review || !user) return;
    const text = draft.trim();
    if (text.length === 0) return;

    setSending(true);
    try {
      const newComment = await addComment({
        reviewId: review.id,
        restaurantId: review.restaurantId,
        text,
      });
      const me: User = {
        id: user.id,
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl,
      } as User;

      setComments((prev) => [...prev, { comment: newComment, author: me }]);
      setDraft("");

      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err) {
      captureError(err, {
        screen: "reviewDetail",
        op: "addComment",
        reviewId: review.id,
      });
      Alert.alert(
        "Couldn't post comment",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setSending(false);
    }
  }, [draft, review, user]);

  // ─── Delete comment ────────────────────────────────────────────────────────

  const handleDeleteComment = useCallback(
    (comment: ReviewComment) => {
      if (!review) return;
      Alert.alert("Delete comment?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteComment(comment.id, review.id);
              setComments((prev) =>
                prev.filter((c) => c.comment.id !== comment.id),
              );
            } catch (err) {
              captureError(err, {
                screen: "reviewDetail",
                op: "deleteComment",
                commentId: comment.id,
              });
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ]);
    },
    [review],
  );

  // ─── Report / block on someone else's comment ───────────────────────────────

  const handleCommentMore = useCallback(
    (comment: ReviewComment) => {
      const authorId = comment.userId;
      const options: {
        text: string;
        style?: "cancel" | "destructive";
        onPress?: () => void;
      }[] = [];

      if (commentReportsEnabled()) {
        options.push({
          text: "Report comment",
          onPress: async () => {
            try {
              await reportComment(
                comment.id,
                comment.reviewId,
                comment.restaurantId,
              );
              Alert.alert(
                "Thanks for reporting",
                "Our team will review this comment.",
              );
            } catch (err) {
              captureError(err, {
                screen: "reviewDetail",
                op: "reportComment",
                commentId: comment.id,
              });
              Alert.alert(
                "Couldn't report",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        });
      }

      options.push({
        text: "Block user",
        style: "destructive",
        onPress: () => {
          Alert.alert(
            "Block this user?",
            "You won't see their comments or reviews anymore.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Block",
                style: "destructive",
                onPress: async () => {
                  try {
                    await blockUser(authorId);
                    setComments((prev) =>
                      prev.filter((c) => c.comment.userId !== authorId),
                    );
                  } catch (err) {
                    captureError(err, {
                      screen: "reviewDetail",
                      op: "blockUser",
                      targetId: authorId,
                    });
                    Alert.alert(
                      "Couldn't block",
                      err instanceof Error ? err.message : "Try again.",
                    );
                  }
                },
              },
            ],
          );
        },
      });

      options.push({ text: "Cancel", style: "cancel" });

      Alert.alert("Comment options", undefined, options);
    },
    [],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={skeletonStyles.wrap}>
          {/* Review post block */}
          <View style={skeletonStyles.postWrap}>
            {/* Author row */}
            <View style={skeletonStyles.authorRow}>
              <SkeletonCircle size={42} />
              <View style={{ flex: 1, gap: 4 }}>
                <Skeleton width="55%" height={14} borderRadius={4} />
                <Skeleton width="40%" height={11} borderRadius={4} />
              </View>
            </View>

            {/* Restaurant tag */}
            <Skeleton
              width={200}
              height={26}
              borderRadius={radius.lg}
              style={{ marginBottom: spacing.md }}
            />

            {/* Stars */}
            <Skeleton
              width={100}
              height={16}
              borderRadius={4}
              style={{ marginBottom: spacing.md }}
            />

            {/* Comment text */}
            <View style={{ marginBottom: spacing.md }}>
              <SkeletonText
                lines={4}
                lineHeight={14}
                gap={8}
                lastLineWidthPct={55}
              />
            </View>

            {/* Photo placeholder */}
            <Skeleton
              width="100%"
              height={200}
              borderRadius={radius.md}
              style={{ marginBottom: spacing.md }}
            />

            {/* Comments header divider */}
            <View style={skeletonStyles.commentsHeader}>
              <Skeleton width={110} height={16} borderRadius={4} />
            </View>
          </View>

          {/* Comment row skeletons */}
          <View style={{ paddingTop: spacing.sm }}>
            <CommentRowSkeleton />
            <CommentRowSkeleton />
            <CommentRowSkeleton />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Real load error (defensive — getReviewById is currently tolerant so
  // this branch only fires if a future change makes it throw).
  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <ErrorState
          variant="screen"
          icon={CloudOff}
          title="Couldn't load this review"
          body="Check your connection and try again."
          onRetry={loadAll}
        />
      </SafeAreaView>
    );
  }

  if (!review) {
    // Genuinely missing — review was deleted, or ID is invalid.
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <ErrorState
          variant="screen"
          icon={MessageCircleQuestion}
          title="Review not found"
          body="It may have been deleted."
        />
      </SafeAreaView>
    );
  }

  // Author is blocked (either direction) — hide the review entirely with a
  // neutral message that doesn't reveal who blocked whom.
  if (blockedUserIds.has(review.userId)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <ErrorState
          variant="screen"
          icon={Ban}
          title="This review isn't available"
          body="You can't view content from this account."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.comment.id}
          ListHeaderComponent={
            <>
              <ReviewPostBlock
                review={review}
                author={author}
                restaurant={restaurant}
                commentCount={comments.length}
              />
              <OwnerReviewResponse
                reviewId={review.id}
                restaurantId={review.restaurantId}
                ownerId={restaurant?.ownerId ?? null}
                currentUserId={user?.id ?? null}
                restaurantName={restaurant?.name}
              />
            </>
          }
          renderItem={({ item }) => (
            <CommentRow
              item={item}
              currentUserId={user?.id ?? null}
              onDelete={handleDeleteComment}
              onMore={handleCommentMore}
              onAuthorPress={(userId) => router.push(`/profile/${userId}`)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.commentSep} />}
          ListEmptyComponent={
            <View style={styles.emptyComments}>
              <Text style={styles.emptyText}>
                No comments yet. Be the first!
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />

        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: keyboardVisible
                ? spacing.md
                : spacing.md + insets.bottom,
            },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          <Pressable
            onPress={handleSend}
            disabled={sending || draft.trim().length === 0}
            style={({ pressed }) => [
              styles.sendBtn,
              (sending || draft.trim().length === 0) && styles.sendBtnDisabled,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
          >
            {sending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Send size={17} color={colors.onPrimary} strokeWidth={2} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header({ onBack }: { onBack: () => void }) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
      </Pressable>
      <Text style={styles.headerTitle}>Review</Text>
      <View style={styles.headerRight} />
    </View>
  );
}

function ReviewPostBlock({
  review,
  author,
  restaurant,
  commentCount,
}: {
  review: Review;
  author: User | null;
  restaurant: Restaurant | null;
  commentCount: number;
}) {
  const router = useRouter();
  const { styles: postStyles, colors } = useThemedStyles(makePostStyles);
  return (
    <View style={postStyles.wrap}>
      <Pressable
        style={postStyles.authorRow}
        onPress={() => router.push(`/profile/${review.userId}`)}
      >
        <Avatar
          fileId={author?.avatarUrl}
          displayName={author?.displayName ?? "Hidden Plate user"}
          userId={review.userId}
          size={42}
        />
        <View style={{ flex: 1 }}>
          <Text style={postStyles.authorName} numberOfLines={1}>
            {author?.displayName ?? "Hidden Plate user"}
          </Text>
          {author?.username ? (
            <Text style={postStyles.authorHandle}>
              @{author.username} · {formatTimeAgo(review.createdAt)}
            </Text>
          ) : (
            <Text style={postStyles.authorHandle}>
              {formatTimeAgo(review.createdAt)}
            </Text>
          )}
        </View>
      </Pressable>

      {restaurant ? (
        <Pressable
          style={postStyles.restaurantTag}
          onPress={() => router.push(`/restaurant/${restaurant.id}`)}
        >
          <MapPin size={12} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={postStyles.restaurantTagText} numberOfLines={1}>
            Reviewed{" "}
            <Text style={postStyles.restaurantTagBold}>{restaurant.name}</Text>
          </Text>
        </Pressable>
      ) : null}

      <View style={postStyles.starsRow}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            size={15}
            color={i <= review.rating ? colors.star : colors.border}
            fill={i <= review.rating ? colors.star : "transparent"}
            strokeWidth={2}
          />
        ))}
      </View>

      {review.comment ? (
        <Text style={postStyles.comment}>{review.comment}</Text>
      ) : null}

      {review.imageIds.length > 0 ? (
        <View style={postStyles.photoGrid}>
          {review.imageIds.slice(0, 3).map((fileId, i) => (
            <Image
              key={fileId}
              source={{ uri: getImageViewUrl(fileId) }}
              style={[
                postStyles.photo,
                i === 0 && review.imageIds.length === 1
                  ? postStyles.photoFull
                  : null,
              ]}
              contentFit="cover"
              transition={250}
            />
          ))}
        </View>
      ) : null}

      <View style={postStyles.commentsHeader}>
        <Text style={postStyles.commentsHeaderText}>
          {commentCount === 0
            ? "Comments"
            : `${commentCount} ${commentCount === 1 ? "Comment" : "Comments"}`}
        </Text>
      </View>
    </View>
  );
}

// Skeleton for a single comment row — matches CommentRow's layout exactly.
function CommentRowSkeleton() {
  const { styles: commentStyles } = useThemedStyles(makeCommentStyles);
  return (
    <View style={commentStyles.row}>
      <SkeletonCircle size={32} />
      <View style={commentStyles.body}>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
          <Skeleton width={90} height={12} borderRadius={4} />
          <Skeleton width={30} height={10} borderRadius={4} />
        </View>
        <SkeletonText lines={2} lineHeight={13} gap={6} lastLineWidthPct={60} />
      </View>
    </View>
  );
}

function CommentRow({
  item,
  currentUserId,
  onDelete,
  onMore,
  onAuthorPress,
}: {
  item: CommentWithAuthor;
  currentUserId: string | null;
  onDelete: (c: ReviewComment) => void;
  onMore: (c: ReviewComment) => void;
  onAuthorPress: (userId: string) => void;
}) {
  const { comment, author } = item;
  const isOwn = comment.userId === currentUserId;
  const { styles: commentStyles, colors } = useThemedStyles(makeCommentStyles);

  return (
    <View style={commentStyles.row}>
      <Pressable onPress={() => onAuthorPress(comment.userId)} hitSlop={4}>
        <Avatar
          fileId={author?.avatarUrl}
          displayName={author?.displayName ?? "User"}
          userId={comment.userId}
          size={32}
        />
      </Pressable>
      <View style={commentStyles.body}>
        <View style={commentStyles.headerRow}>
          <Pressable
            onPress={() => onAuthorPress(comment.userId)}
            hitSlop={4}
            style={{ flexShrink: 1 }}
          >
            <Text style={commentStyles.name} numberOfLines={1}>
              {author?.displayName ?? "Hidden Plate user"}
            </Text>
          </Pressable>
          <Text style={commentStyles.time}>
            · {formatTimeAgo(comment.createdAt)}
          </Text>
          {isOwn ? (
            <Pressable
              onPress={() => onDelete(comment)}
              hitSlop={8}
              style={commentStyles.deleteBtn}
              accessibilityRole="button"
              accessibilityLabel="Delete comment"
            >
              <Trash2 size={14} color={colors.textMuted} strokeWidth={2} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => onMore(comment)}
              hitSlop={8}
              style={commentStyles.deleteBtn}
              accessibilityRole="button"
              accessibilityLabel="Comment options"
            >
              <Ellipsis size={16} color={colors.textMuted} strokeWidth={2} />
            </Pressable>
          )}
        </View>
        <Text style={commentStyles.text}>{comment.text}</Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.cardBackground,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  headerRight: { width: 36 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
  },
  listContent: { paddingBottom: spacing.lg },
  commentSep: { height: 1, backgroundColor: "transparent" },
  emptyComments: {
    paddingVertical: spacing.huge,
    alignItems: "center",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.cardBackground,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.pageBackground,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  });
}

function makePostStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
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
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  photo: {
    width: (SW - spacing.screen * 2 - spacing.sm * 2) / 3,
    height: 100,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
  },
  photoFull: {
    width: SW - spacing.screen * 2,
    height: 200,
  },
  commentsHeader: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: spacing.sm,
  },
  commentsHeaderText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  });
}

function makeCommentStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  body: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  time: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  deleteBtn: {
    marginLeft: "auto",
    padding: 4,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  });
}

function makeSkeletonStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.cardBackground,
  },
  postWrap: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  commentsHeader: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: spacing.sm,
  },
  });
}
