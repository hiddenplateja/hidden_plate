// app/post/[id].tsx
// Community post + comment thread screen. Mirrors app/review/[id].tsx but for
// plain posts: no rating, no restaurant tag. Likes live in the postLikes
// collection and comments in postComments — both self-contained (no server
// Function), so counts come straight from those collections.
//
// Failure handling: getPostById returns null both for "not found" and "fetch
// failed"; we track loadError separately to show "couldn't load" vs "post not
// found". Comment/author load failures are absorbed — the post still renders.

import {
  ArrowLeft,
  CloudOff,
  Ellipsis,
  Flag,
  Heart,
  MessageCircleQuestion,
  Send,
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
import { PhotoViewer } from "@/components/PhotoViewer";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  getPostLikeCount,
  hasUserLikedPost,
  likePost,
  postLikesEnabled,
  unlikePost,
} from "@/services/postLikes";
import {
  addPostComment,
  deletePostComment,
  listCommentsForPost,
  postCommentsEnabled,
  POST_COMMENT_MAX_LENGTH,
} from "@/services/postComments";
import { deletePost, getPostById } from "@/services/posts";
import {
  postCommentReportsEnabled,
  postReportsEnabled,
  reportPost,
  reportPostComment,
} from "@/services/reports";
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
import type { Post, PostComment } from "@/types/post";
import type { User } from "@/types/user";

const { width: SW } = Dimensions.get("window");

interface CommentWithAuthor {
  comment: PostComment;
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

export default function PostScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  // Bottom safe-area inset so the composer sits above the device nav bar / home
  // indicator instead of flush against the screen edge. Collapsed while the
  // keyboard is up (the bar rides above it via KeyboardAvoidingView, so the
  // inset would just add a gap).
  const insets = useSafeAreaInsets();
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

  const [post, setPost] = useState<Post | null>(null);
  const [author, setAuthor] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [commentCount, setCommentCount] = useState(0);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const likeInFlight = useRef(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(false);
    try {
      const p = await getPostById(id);
      if (!p) {
        // getPostById swallows both "missing" and "errored" — show the
        // generic not-found UI (retry still available).
        setPost(null);
        setLoading(false);
        return;
      }
      setPost(p);

      // Author, comments, like state — all best-effort; the post already
      // renders even if these fail.
      const [authors, page, likeState, likes] = await Promise.all([
        getUsersByIds([p.userId]),
        listCommentsForPost(p.id).catch(() => ({
          items: [] as PostComment[],
          total: 0,
          hasMore: false,
          nextCursor: null,
        })),
        postLikesEnabled() ? hasUserLikedPost(p.id) : Promise.resolve(false),
        postLikesEnabled() ? getPostLikeCount(p.id) : Promise.resolve(0),
      ]);
      setAuthor(authors.get(p.userId) ?? null);
      setLiked(likeState);
      setLikeCount(likes);

      const commenterIds = page.items.map((c) => c.userId);
      const commentAuthors =
        commenterIds.length > 0
          ? await getUsersByIds(commenterIds).catch(() => new Map())
          : new Map();
      setComments(
        page.items.map((comment) => ({
          comment,
          author: commentAuthors.get(comment.userId) ?? null,
        })),
      );
      setCommentCount(page.total);
    } catch (err) {
      captureError(err, { screen: "post", op: "load", postId: id });
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleLike = useCallback(async () => {
    if (!post || !postLikesEnabled() || likeInFlight.current) return;
    // Can't like your own post — matches the review card behavior.
    if (user?.id === post.userId) return;
    likeInFlight.current = true;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    try {
      if (wasLiked) await unlikePost(post.id);
      else await likePost(post.id);
    } catch (err) {
      // Revert the optimistic toggle; the service already reported.
      setLiked(wasLiked);
      setLikeCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
      captureError(err, { screen: "post", op: "toggleLike", postId: post.id });
    } finally {
      likeInFlight.current = false;
    }
  }, [post, liked, user?.id]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!post || !text || sending) return;
    setSending(true);
    Keyboard.dismiss();
    try {
      const created = await addPostComment({ postId: post.id, text });
      setComments((prev) => [
        ...prev,
        { comment: created, author: user ?? null },
      ]);
      setCommentCount((c) => c + 1);
      setDraft("");
    } catch (err) {
      captureError(err, { screen: "post", op: "addComment", postId: post.id });
      Alert.alert(
        "Couldn't post comment",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setSending(false);
    }
  }, [draft, post, sending, user]);

  const handleDeleteComment = useCallback(
    (comment: PostComment) => {
      Alert.alert("Delete comment?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // Optimistic removal.
            setComments((prev) =>
              prev.filter((c) => c.comment.id !== comment.id),
            );
            setCommentCount((c) => Math.max(0, c - 1));
            try {
              await deletePostComment(comment.id);
            } catch (err) {
              captureError(err, {
                screen: "post",
                op: "deleteComment",
                commentId: comment.id,
              });
              // Re-load to restore truth on failure.
              load();
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ]);
    },
    [load],
  );

  // Report someone else's comment. Optimistically removes it from the thread
  // (for this viewer) once filed, mirroring the post/report behavior.
  const handleReportComment = useCallback((comment: PostComment) => {
    Alert.alert("Report comment", "Report this as inappropriate?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          try {
            await reportPostComment(comment.id, comment.postId, "inappropriate");
            setComments((prev) =>
              prev.filter((c) => c.comment.id !== comment.id),
            );
            Alert.alert(
              "Reported",
              "Thank you for keeping our community safe.",
            );
          } catch (err) {
            captureError(err, {
              screen: "post",
              op: "reportComment",
              commentId: comment.id,
            });
            Alert.alert(
              "Couldn't report",
              err instanceof Error ? err.message : "Please try again.",
            );
          }
        },
      },
    ]);
  }, []);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/community");
  }, [router]);

  // ⋯ menu: delete your own post, or report someone else's. Mirrors the
  // community feed's post manage sheet, condensed into an action alert.
  const handleMore = useCallback(() => {
    if (!post) return;
    const own = user?.id === post.userId;

    if (own) {
      Alert.alert("Delete post?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deletePost(post.id);
              onBack();
            } catch (err) {
              captureError(err, {
                screen: "post",
                op: "deletePost",
                postId: post.id,
              });
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ]);
      return;
    }

    Alert.alert("Report post", "Report this as inappropriate?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          try {
            await reportPost(post.id, "inappropriate");
            Alert.alert("Reported", "Thank you for keeping our community safe.");
          } catch (err) {
            captureError(err, {
              screen: "post",
              op: "reportPost",
              postId: post.id,
            });
            Alert.alert(
              "Couldn't report",
              err instanceof Error ? err.message : "Please try again.",
            );
          }
        },
      },
    ]);
  }, [post, user?.id, onBack]);

  // Show the ⋯ button only when there's an action available: your own post
  // (delete) or a reportable one (post reporting configured).
  const canManage =
    !!post && (user?.id === post.userId || postReportsEnabled());

  const commentingOff = !postCommentsEnabled();

  // ── Render states ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={onBack} styles={styles} colors={colors} />
        <View style={styles.postWrap}>
          <View style={styles.authorRow}>
            <SkeletonCircle size={42} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="50%" height={14} borderRadius={4} />
              <Skeleton width="35%" height={11} borderRadius={4} />
            </View>
          </View>
          <SkeletonText lines={3} lineHeight={16} gap={8} lastLineWidthPct={60} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !post) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={onBack} styles={styles} colors={colors} />
        <ErrorState
          variant="screen"
          icon={loadError ? CloudOff : MessageCircleQuestion}
          title={loadError ? "Couldn't load this post" : "Post not found"}
          body={
            loadError
              ? "Check your connection and try again."
              : "This post may have been deleted."
          }
          onRetry={loadError ? load : undefined}
        />
      </SafeAreaView>
    );
  }

  const isOwnPost = user?.id === post.userId;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header
        onBack={onBack}
        onMore={canManage ? handleMore : undefined}
        styles={styles}
        colors={colors}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={comments}
          keyExtractor={(c) => c.comment.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <PostBlock
              post={post}
              author={author}
              liked={liked}
              likeCount={likeCount}
              canLike={postLikesEnabled() && !isOwnPost}
              onToggleLike={handleToggleLike}
              commentCount={commentCount}
              onOpenPhoto={(i) => setPhotoIndex(i)}
              onAuthorPress={() => router.push(`/profile/${post.userId}`)}
            />
          }
          renderItem={({ item }) => (
            <CommentRow
              item={item}
              currentUserId={user?.id ?? null}
              onDelete={handleDeleteComment}
              onReport={
                postCommentReportsEnabled() ? handleReportComment : undefined
              }
              onAuthorPress={(uid) => router.push(`/profile/${uid}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyComments}>
              <Text style={styles.emptyText}>
                {commentingOff
                  ? "Comments aren't available yet."
                  : "No comments yet — be the first."}
              </Text>
            </View>
          }
        />

        {!commentingOff ? (
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
              style={styles.input}
              placeholder="Add a comment…"
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={POST_COMMENT_MAX_LENGTH}
              editable={!sending}
            />
            <Pressable
              onPress={handleSend}
              disabled={sending || draft.trim().length === 0}
              style={[
                styles.sendBtn,
                (sending || draft.trim().length === 0) &&
                  styles.sendBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Send size={18} color={colors.white} strokeWidth={2.2} />
              )}
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <PhotoViewer
        photos={post.imageIds.map(getImageViewUrl)}
        index={photoIndex}
        onClose={() => setPhotoIndex(null)}
      />
    </SafeAreaView>
  );
}

function Header({
  onBack,
  onMore,
  styles,
  colors,
}: {
  onBack: () => void;
  onMore?: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
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
      <Text style={styles.headerTitle}>Post</Text>
      {onMore ? (
        <Pressable
          onPress={onMore}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Ellipsis size={20} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
      ) : (
        <View style={styles.headerRight} />
      )}
    </View>
  );
}

function PostBlock({
  post,
  author,
  liked,
  likeCount,
  canLike,
  onToggleLike,
  commentCount,
  onOpenPhoto,
  onAuthorPress,
}: {
  post: Post;
  author: User | null;
  liked: boolean;
  likeCount: number;
  canLike: boolean;
  onToggleLike: () => void;
  commentCount: number;
  onOpenPhoto: (index: number) => void;
  onAuthorPress: () => void;
}) {
  const { styles: postStyles, colors } = useThemedStyles(makePostStyles);
  return (
    <View style={postStyles.wrap}>
      <Pressable style={postStyles.authorRow} onPress={onAuthorPress}>
        <Avatar
          fileId={author?.avatarUrl}
          displayName={author?.displayName ?? "Hidden Plate user"}
          userId={post.userId}
          size={42}
        />
        <View style={{ flex: 1 }}>
          <Text style={postStyles.authorName} numberOfLines={1}>
            {author?.displayName ?? "Hidden Plate user"}
          </Text>
          <Text style={postStyles.authorHandle}>
            {author?.username ? `@${author.username} · ` : ""}
            {formatTimeAgo(post.createdAt)}
          </Text>
        </View>
      </Pressable>

      <Text style={postStyles.text}>{post.text}</Text>

      {post.imageIds.length > 0 ? (
        <View style={postStyles.photoGrid}>
          {post.imageIds.slice(0, 3).map((fileId, i) => (
            <Pressable key={fileId} onPress={() => onOpenPhoto(i)}>
              <Image
                source={{ uri: getImageViewUrl(fileId) }}
                style={[
                  postStyles.photo,
                  post.imageIds.length === 1 ? postStyles.photoFull : null,
                ]}
                contentFit="cover"
                transition={250}
                cachePolicy="memory-disk"
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={postStyles.actionsRow}>
        <Pressable
          onPress={onToggleLike}
          disabled={!canLike}
          hitSlop={6}
          style={({ pressed }) => [
            postStyles.actionBtn,
            pressed && { opacity: 0.6 },
            !canLike && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={liked ? "Unlike" : "Like"}
        >
          <Heart
            size={20}
            color={liked ? colors.primary : colors.textMuted}
            fill={liked ? colors.primary : "transparent"}
            strokeWidth={2}
          />
          <Text
            style={[
              postStyles.actionCount,
              liked && { color: colors.primary },
            ]}
          >
            {likeCount}
          </Text>
        </Pressable>
      </View>

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
  onReport,
  onAuthorPress,
}: {
  item: CommentWithAuthor;
  currentUserId: string | null;
  onDelete: (c: PostComment) => void;
  /** Report someone else's comment. Omitted when post-comment reporting is off. */
  onReport?: (c: PostComment) => void;
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
          ) : onReport ? (
            <Pressable
              onPress={() => onReport(comment)}
              hitSlop={8}
              style={commentStyles.deleteBtn}
              accessibilityRole="button"
              accessibilityLabel="Report comment"
            >
              <Flag size={14} color={colors.textMuted} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
        <Text style={commentStyles.text}>{comment.text}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    backBtn: {
      width: 36,
      height: 36,
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
    listContent: { paddingBottom: spacing.lg },
    postWrap: { paddingHorizontal: spacing.screen, paddingTop: spacing.lg },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    emptyComments: { paddingVertical: spacing.huge, alignItems: "center" },
    emptyText: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textMuted,
    },
    inputBar: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: spacing.screen,
      // paddingBottom is applied inline (safe-area inset, collapsed while typing).
      paddingTop: spacing.md,
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
    wrap: { paddingHorizontal: spacing.screen, paddingTop: spacing.lg },
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
    text: {
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
    photoFull: { width: SW - spacing.screen * 2, height: 200 },
    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      marginBottom: spacing.sm,
    },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
    actionCount: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
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
    deleteBtn: { marginLeft: "auto", padding: 4 },
    text: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textPrimary,
      lineHeight: 20,
    },
  });
}
