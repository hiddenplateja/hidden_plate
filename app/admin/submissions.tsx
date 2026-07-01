// app/admin/submissions.tsx
// Admin: queue of user-submitted restaurants awaiting approval (isActive=false).
// Approve publishes them; Edit opens the full editor; Reject deletes.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
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
import {
  approveRestaurant,
  deleteRestaurant,
  listAdminRestaurants,
} from "@/services/restaurants";
import { getImagePreviewUrl } from "@/services/storage";
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
import type { User } from "@/types/user";
import { getLocationLine } from "@/utils/restaurantDisplay";

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-JM", {
    day: "numeric",
    month: "short",
  });
}

export default function AdminSubmissions() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [items, setItems] = useState<Restaurant[]>([]);
  const [authors, setAuthors] = useState<Map<string, User>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listAdminRestaurants({ status: "pending" });
      setItems(page.items);
      const ids = page.items
        .map((r) => r.addedBy)
        .filter((v): v is string => !!v);
      if (ids.length > 0) {
        getUsersByIds(ids)
          .then(setAuthors)
          .catch(() => {});
      }
    } catch {
      setItems([]);
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

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleApprove = useCallback(async (r: Restaurant) => {
    setBusyId(r.id);
    try {
      await approveRestaurant(r.id);
      setItems((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err) {
      Alert.alert(
        "Couldn't approve",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleReject = useCallback((r: Restaurant) => {
    Alert.alert(
      "Reject submission?",
      `This permanently deletes "${r.name}" and its photos.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            setBusyId(r.id);
            try {
              await deleteRestaurant(r.id);
              setItems((prev) => prev.filter((x) => x.id !== r.id));
            } catch (err) {
              Alert.alert(
                "Couldn't reject",
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
      <AdminHeader title="Submissions" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const author = item.addedBy ? authors.get(item.addedBy) : null;
            const coverId =
              item.coverImageId ?? item.imageIds[0] ?? null;
            const thumb = coverId ? getImagePreviewUrl(coverId) : null;
            const location = getLocationLine(item);
            const busy = busyId === item.id;
            return (
              <View style={styles.card}>
                <Pressable
                  style={styles.cardTop}
                  onPress={() =>
                    router.push({
                      pathname: "/admin/restaurants/[id]",
                      params: { id: item.id },
                    })
                  }
                  accessibilityRole="button"
                >
                  {thumb ? (
                    <Image
                      source={{ uri: thumb }}
                      style={styles.thumb}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <MaterialCommunityIcons
                        name="silverware-fork-knife"
                        size={18}
                        color={colors.textMuted}
                      />
                    </View>
                  )}
                  <View style={styles.cardText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {location ? (
                      <Text style={styles.sub} numberOfLines={1}>
                        {location}
                      </Text>
                    ) : null}
                    <Text style={styles.meta} numberOfLines={1}>
                      {author ? `@${author.username} · ` : ""}
                      {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => handleApprove(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.approveBtn]}
                    accessibilityRole="button"
                    accessibilityLabel="Approve"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : (
                      <>
                        <MaterialCommunityIcons
                          name="check"
                          size={16}
                          color={colors.textInverse}
                        />
                        <Text style={styles.approveText}>Approve</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/admin/restaurants/[id]",
                        params: { id: item.id },
                      })
                    }
                    disabled={busy}
                    style={[styles.actionBtn, styles.editBtn]}
                    accessibilityRole="button"
                    accessibilityLabel="Edit"
                  >
                    <MaterialCommunityIcons
                      name="pencil"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.editText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleReject(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.rejectBtn]}
                    accessibilityRole="button"
                    accessibilityLabel="Reject"
                  >
                    <MaterialCommunityIcons
                      name="close"
                      size={16}
                      color={colors.error}
                    />
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
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="check-all"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptyBody}>No submissions to review.</Text>
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
    overflow: "hidden",
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1, gap: 2 },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 40,
    borderRadius: radius.md,
  },
  approveBtn: { flex: 1, backgroundColor: colors.primary },
  approveText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textInverse,
  },
  editBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  rejectBtn: {
    width: 44,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
