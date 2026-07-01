// app/admin/reports.tsx
// Admin: reported reviews, grouped by review. Delete the review, or dismiss
// the report(s) if the content is fine.

import { MaterialCommunityIcons } from "@expo/vector-icons";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { Avatar } from "@/components/Avatar";
import {
  deleteReport,
  listReports,
  type ReviewReport,
} from "@/services/reports";
import { deleteReview, getReviewById } from "@/services/reviews";
import { getUsersByIds } from "@/services/users";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

interface ReportGroup {
  reviewId: string;
  reports: ReviewReport[];
  review: Review | null;
  author: User | null;
}

export default function AdminReports() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: reports } = await listReports();
      const byReview = new Map<string, ReviewReport[]>();
      for (const rep of reports) {
        const arr = byReview.get(rep.reviewId) ?? [];
        arr.push(rep);
        byReview.set(rep.reviewId, arr);
      }
      const reviewIds = Array.from(byReview.keys());
      const reviews = await Promise.all(
        reviewIds.map((id) => getReviewById(id)),
      );
      const authorIds = reviews
        .filter((r): r is Review => r !== null)
        .map((r) => r.userId);
      const authorMap =
        authorIds.length > 0
          ? await getUsersByIds(authorIds).catch(() => new Map<string, User>())
          : new Map<string, User>();

      const built: ReportGroup[] = reviewIds.map((id, i) => {
        const review = reviews[i];
        return {
          reviewId: id,
          reports: byReview.get(id) ?? [],
          review,
          author: review ? authorMap.get(review.userId) ?? null : null,
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
    setBusyId(group.reviewId);
    try {
      await Promise.all(group.reports.map((r) => deleteReport(r.id)));
      setGroups((prev) => prev.filter((g) => g.reviewId !== group.reviewId));
    } catch (err) {
      Alert.alert(
        "Couldn't dismiss",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const removeReview = useCallback((group: ReportGroup) => {
    Alert.alert(
      "Delete this review?",
      "Removes the review and clears its reports. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusyId(group.reviewId);
            try {
              await deleteReview(group.reviewId);
              await Promise.all(group.reports.map((r) => deleteReport(r.id)));
              setGroups((prev) =>
                prev.filter((g) => g.reviewId !== group.reviewId),
              );
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
      <AdminHeader title="Reports" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.reviewId}
          renderItem={({ item }) => {
            const reasons = Array.from(
              new Set(item.reports.map((r) => r.reason)),
            ).join(", ");
            const busy = busyId === item.reviewId;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.countPill}>
                    <MaterialCommunityIcons
                      name="flag"
                      size={12}
                      color={colors.error}
                    />
                    <Text style={styles.countText}>
                      {item.reports.length}{" "}
                      {item.reports.length === 1 ? "report" : "reports"}
                    </Text>
                  </View>
                  <Text style={styles.reasons} numberOfLines={1}>
                    {reasons}
                  </Text>
                </View>

                {item.review ? (
                  <Pressable
                    style={styles.review}
                    onPress={() => router.push(`/review/${item.reviewId}`)}
                    accessibilityRole="button"
                  >
                    <Avatar
                      fileId={item.author?.avatarUrl}
                      displayName={item.author?.displayName ?? "User"}
                      userId={item.review.userId}
                      size={36}
                    />
                    <View style={styles.reviewText}>
                      <Text style={styles.reviewMeta} numberOfLines={1}>
                        {item.author ? `@${item.author.username} · ` : ""}
                        {"★".repeat(item.review.rating)}
                      </Text>
                      <Text style={styles.reviewComment} numberOfLines={3}>
                        {item.review.comment ?? "(no comment)"}
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <Text style={styles.removed}>
                    This review has already been removed.
                  </Text>
                )}

                <View style={styles.actions}>
                  {item.review ? (
                    <Pressable
                      onPress={() => removeReview(item)}
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
                        <Text style={styles.deleteText}>Delete review</Text>
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
                <MaterialCommunityIcons
                  name="flag-checkered"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>No reports</Text>
              <Text style={styles.emptyBody}>
                Reported reviews will show up here.
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
  listContent: { padding: spacing.screen, paddingBottom: 100, gap: spacing.md },
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
  review: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  reviewText: { flex: 1, gap: 2 },
  reviewMeta: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.star,
  },
  reviewComment: {
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
