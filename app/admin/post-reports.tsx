// app/admin/post-reports.tsx
// Admin: reported community posts, grouped by post. Delete the post, or dismiss
// the report(s) if the content is fine. Mirrors app/admin/comment-reports.tsx.

import { Flag, FlagOff } from "lucide-react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { Avatar } from "@/components/Avatar";
import { deletePost, getPostById } from "@/services/posts";
import {
  deletePostReport,
  listPostReports,
  type PostReport,
} from "@/services/reports";
import { getUsersByIds } from "@/services/users";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Post } from "@/types/post";
import type { User } from "@/types/user";

interface ReportGroup {
  postId: string;
  reports: PostReport[];
  post: Post | null;
  author: User | null;
}

export default function AdminPostReports() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: reports } = await listPostReports();
      const byPost = new Map<string, PostReport[]>();
      for (const rep of reports) {
        const arr = byPost.get(rep.postId) ?? [];
        arr.push(rep);
        byPost.set(rep.postId, arr);
      }
      const postIds = Array.from(byPost.keys());
      const posts = await Promise.all(postIds.map((id) => getPostById(id)));
      const authorIds = posts
        .filter((p): p is Post => p !== null)
        .map((p) => p.userId);
      const authorMap =
        authorIds.length > 0
          ? await getUsersByIds(authorIds).catch(() => new Map<string, User>())
          : new Map<string, User>();

      const built: ReportGroup[] = postIds.map((id, i) => {
        const post = posts[i];
        return {
          postId: id,
          reports: byPost.get(id) ?? [],
          post,
          author: post ? authorMap.get(post.userId) ?? null : null,
        };
      });
      setGroups(built);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const dismiss = useCallback(async (group: ReportGroup) => {
    setBusyId(group.postId);
    try {
      await Promise.all(group.reports.map((r) => deletePostReport(r.id)));
      setGroups((prev) => prev.filter((g) => g.postId !== group.postId));
    } catch (err) {
      Alert.alert(
        "Couldn't dismiss",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const removePost = useCallback((group: ReportGroup) => {
    Alert.alert(
      "Delete this post?",
      "Removes the post and clears its reports. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusyId(group.postId);
            try {
              await deletePost(group.postId);
              await Promise.all(
                group.reports.map((r) => deletePostReport(r.id)),
              );
              setGroups((prev) => prev.filter((g) => g.postId !== group.postId));
            } catch (err) {
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again.",
              );
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Post reports" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.postId}
          renderItem={({ item }) => {
            const reasons = Array.from(
              new Set(item.reports.map((r) => r.reason)),
            ).join(", ");
            const busy = busyId === item.postId;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.countPill}>
                    <Flag size={12} color={colors.error} strokeWidth={2} />
                    <Text style={styles.countText}>
                      {item.reports.length}{" "}
                      {item.reports.length === 1 ? "report" : "reports"}
                    </Text>
                  </View>
                  <Text style={styles.reasons} numberOfLines={1}>
                    {reasons}
                  </Text>
                </View>

                {item.post ? (
                  <Pressable
                    style={styles.post}
                    onPress={() =>
                      router.push(`/post/${item.postId}` as unknown as Href)
                    }
                    accessibilityRole="button"
                  >
                    <Avatar
                      fileId={item.author?.avatarUrl}
                      displayName={item.author?.displayName ?? "User"}
                      userId={item.post.userId}
                      size={36}
                    />
                    <View style={styles.postText}>
                      <Text style={styles.postMeta} numberOfLines={1}>
                        {item.author
                          ? `@${item.author.username}`
                          : "Hidden Plate user"}
                      </Text>
                      <Text style={styles.postBody} numberOfLines={4}>
                        {item.post.text}
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <Text style={styles.removed}>
                    This post has already been removed.
                  </Text>
                )}

                <View style={styles.actions}>
                  {item.post ? (
                    <Pressable
                      onPress={() => removePost(item)}
                      disabled={busy}
                      style={[styles.actionBtn, styles.deleteBtn]}
                      accessibilityRole="button"
                    >
                      {busy ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.textInverse}
                        />
                      ) : (
                        <Text style={styles.deleteText}>Delete post</Text>
                      )}
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => dismiss(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.dismissBtn]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIconWrap}>
                <FlagOff size={30} color={colors.primary} strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>No reports</Text>
              <Text style={styles.emptyBody}>
                Reported posts will show up here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.pageBackground },
    listContent: {
      padding: spacing.screen,
      paddingBottom: 100,
      gap: spacing.md,
    },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    countPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.errorBg,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.full,
    },
    countText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.error,
    },
    reasons: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "capitalize",
    },
    post: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    postText: { flex: 1, gap: 2 },
    postMeta: {
      fontFamily: fonts.medium,
      fontSize: T.size.xs,
      color: colors.textMuted,
    },
    postBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textPrimary,
      lineHeight: 19,
    },
    removed: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      fontStyle: "italic",
      paddingVertical: spacing.sm,
    },
    actions: { flexDirection: "row", gap: spacing.sm },
    actionBtn: {
      flex: 1,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    deleteBtn: { backgroundColor: colors.error },
    deleteText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textInverse,
    },
    dismissBtn: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dismissText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textPrimary,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.huge,
      paddingHorizontal: spacing.xxxl,
      gap: spacing.sm,
    },
    emptyIconWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    emptyTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
      color: colors.textPrimary,
    },
    emptyBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
    },
  });
}
