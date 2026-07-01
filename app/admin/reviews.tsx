// app/admin/reviews.tsx
// Admin: recent reviews. Tap to open the thread (read + remove comments);
// delete a review outright with the trash action.

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
import { getRestaurantsByIds } from "@/services/restaurants";
import { deleteReview, listLatestReviews } from "@/services/reviews";
import { getUsersByIds } from "@/services/users";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import type { Review } from "@/types/review";
import type { User } from "@/types/user";

const PAGE = 25;

export default function AdminReviews() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [items, setItems] = useState<Review[]>([]);
  const [authors, setAuthors] = useState<Map<string, User>>(new Map());
  const [restaurants, setRestaurants] = useState<Map<string, Restaurant>>(
    new Map(),
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const hydrate = useCallback(async (reviews: Review[]) => {
    const [a, r] = await Promise.all([
      getUsersByIds(reviews.map((x) => x.userId)).catch(
        () => new Map<string, User>(),
      ),
      getRestaurantsByIds(reviews.map((x) => x.restaurantId)).catch(
        () => new Map<string, Restaurant>(),
      ),
    ]);
    setAuthors((prev) => new Map([...prev, ...a]));
    setRestaurants((prev) => new Map([...prev, ...r]));
  }, []);

  const load = useCallback(async () => {
    try {
      const page = await listLatestReviews({ pageSize: PAGE });
      setItems(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      hydrate(page.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const page = await listLatestReviews({ pageSize: PAGE, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      hydrate(page.items);
    } catch {
      // keep what we have
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, cursor, hydrate]);

  const handleDelete = useCallback((review: Review) => {
    Alert.alert(
      "Delete review?",
      "This permanently removes the review. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteReview(review.id);
              setItems((prev) => prev.filter((x) => x.id !== review.id));
            } catch (err) {
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Reviews & comments" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const author = authors.get(item.userId) ?? null;
            const restaurant = restaurants.get(item.restaurantId) ?? null;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => router.push(`/review/${item.id}`)}
                accessibilityRole="button"
              >
                <Avatar
                  fileId={author?.avatarUrl}
                  displayName={author?.displayName ?? "User"}
                  userId={item.userId}
                  size={40}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowTop} numberOfLines={1}>
                    {restaurant?.name ?? "Unknown restaurant"}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {author ? `@${author.username} · ` : ""}
                    {"★".repeat(item.rating)}
                  </Text>
                  {item.comment ? (
                    <Text style={styles.rowComment} numberOfLines={2}>
                      {item.comment}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => handleDelete(item)}
                  hitSlop={8}
                  style={styles.trash}
                  accessibilityRole="button"
                  accessibilityLabel="Delete review"
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={20}
                    color={colors.error}
                  />
                </Pressable>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
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
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No reviews yet.</Text>
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
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  listContent: { paddingBottom: 100 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
  },
  pressed: { backgroundColor: colors.pageBackground },
  rowText: { flex: 1, gap: 2 },
  rowTop: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  rowMeta: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.star,
  },
  rowComment: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: 2,
  },
  trash: { paddingTop: 2 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: spacing.screen + 40 + spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.huge,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
  },
  footer: { paddingVertical: spacing.lg, alignItems: "center" },
  });
}
