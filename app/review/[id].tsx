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

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/hooks/useAuth";
import { getRestaurantById } from "@/services/restaurants";
import {
    addComment,
    deleteComment,
    listCommentsForReview,
} from "@/services/reviewComments";
import { getReviewById } from "@/services/reviews";
import { getImageViewUrl } from "@/services/storage";
import { getUsersByIds } from "@/services/users";
import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";
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

  const [review, setReview] = useState<Review | null>(null);
  const [author, setAuthor] = useState<User | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList>(null);

  // ─── Initial load ──────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const fetchedReview = await getReviewById(id);
      if (!fetchedReview) {
        setLoading(false);
        return;
      }
      setReview(fetchedReview);

      const [authorMap, fetchedRestaurant, commentsPage] = await Promise.all([
        getUsersByIds([fetchedReview.userId]),
        getRestaurantById(fetchedReview.restaurantId).catch(() => null),
        listCommentsForReview(id, { pageSize: 100 }),
      ]);

      setAuthor(authorMap.get(fetchedReview.userId) ?? null);
      setRestaurant(fetchedRestaurant);

      const commenterIds = Array.from(
        new Set(commentsPage.items.map((c) => c.userId)),
      );
      const commenterMap = await getUsersByIds(commenterIds);
      setComments(
        commentsPage.items.map((c) => ({
          comment: c,
          author: commenterMap.get(c.userId) ?? null,
        })),
      );
    } catch (err) {
      console.warn("[review] load failed:", err);
    } finally {
      setLoading(false);
    }
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

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!review) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>Review not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.comment.id}
          ListHeaderComponent={
            <ReviewPostBlock
              review={review}
              author={author}
              restaurant={restaurant}
              commentCount={comments.length}
            />
          }
          renderItem={({ item }) => (
            <CommentRow
              item={item}
              currentUserId={user?.id ?? null}
              onDelete={handleDeleteComment}
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

        <View style={styles.inputBar}>
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
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <MaterialCommunityIcons
                name="send"
                size={18}
                color={colors.textInverse}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <MaterialCommunityIcons
          name="arrow-left"
          size={22}
          color={colors.textPrimary}
        />
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
          <MaterialCommunityIcons
            name="map-marker"
            size={12}
            color={colors.primary}
          />
          <Text style={postStyles.restaurantTagText} numberOfLines={1}>
            Reviewed{" "}
            <Text style={postStyles.restaurantTagBold}>{restaurant.name}</Text>
          </Text>
        </Pressable>
      ) : null}

      <View style={postStyles.starsRow}>
        {[1, 2, 3, 4, 5].map((i) => (
          <MaterialCommunityIcons
            key={i}
            name={i <= review.rating ? "star" : "star-outline"}
            size={16}
            color={i <= review.rating ? colors.star : colors.border}
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

function CommentRow({
  item,
  currentUserId,
  onDelete,
  onAuthorPress,
}: {
  item: CommentWithAuthor;
  currentUserId: string | null;
  onDelete: (c: ReviewComment) => void;
  onAuthorPress: (userId: string) => void;
}) {
  const { comment, author } = item;
  const isOwn = comment.userId === currentUserId;

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
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={14}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
        <Text style={commentStyles.text}>{comment.text}</Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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

const postStyles = StyleSheet.create({
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

const commentStyles = StyleSheet.create({
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
