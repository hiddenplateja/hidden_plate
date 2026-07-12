// app/admin/claims.tsx
// Admin: queue of "claim your restaurant" requests awaiting review.
// Approve sets the restaurant's ownerId (grants the verified-owner badge +,
// later, respond-to-reviews / buy-featured). Reject leaves it unowned.

import { BadgeCheck, CheckCheck, UtensilsCrossed, X } from "lucide-react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import {
  approveClaim,
  listClaims,
  rejectClaim,
  type RestaurantClaim,
} from "@/services/claims";
import { getRestaurantsByIds } from "@/services/restaurants";
import { getImagePreviewUrl } from "@/services/storage";
import { getUsersByIds } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
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

export default function AdminClaims() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [items, setItems] = useState<RestaurantClaim[]>([]);
  const [restaurants, setRestaurants] = useState<Map<string, Restaurant>>(
    new Map(),
  );
  const [claimants, setClaimants] = useState<Map<string, User>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listClaims({ status: "pending" });
      setItems(page.items);
      const restaurantIds = page.items.map((c) => c.restaurantId);
      const userIds = page.items.map((c) => c.userId);
      if (restaurantIds.length > 0) {
        getRestaurantsByIds(restaurantIds)
          .then(setRestaurants)
          .catch(() => {});
        getUsersByIds(userIds)
          .then(setClaimants)
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

  const handleApprove = useCallback(
    (claim: RestaurantClaim) => {
      const r = restaurants.get(claim.restaurantId);
      Alert.alert(
        "Approve claim?",
        `Make ${claim.contactName} the verified owner of ${
          r?.name ?? "this restaurant"
        }?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Approve",
            onPress: async () => {
              setBusyId(claim.id);
              try {
                await approveClaim(claim);
                setItems((prev) => prev.filter((x) => x.id !== claim.id));
              } catch (err) {
                Alert.alert(
                  "Couldn't approve",
                  err instanceof Error ? err.message : "Try again.",
                );
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [restaurants],
  );

  const handleReject = useCallback((claim: RestaurantClaim) => {
    Alert.alert("Reject claim?", "The restaurant stays unowned.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject",
        style: "destructive",
        onPress: async () => {
          setBusyId(claim.id);
          try {
            await rejectClaim(claim);
            setItems((prev) => prev.filter((x) => x.id !== claim.id));
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
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Claims" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const restaurant = restaurants.get(item.restaurantId);
            const claimant = claimants.get(item.userId);
            const coverId =
              restaurant?.coverImageId ?? restaurant?.imageIds[0] ?? null;
            const thumb = coverId ? getImagePreviewUrl(coverId) : null;
            const location = restaurant ? getLocationLine(restaurant) : null;
            const busy = busyId === item.id;
            return (
              <View style={styles.card}>
                <Pressable
                  style={styles.cardTop}
                  onPress={() =>
                    router.push({
                      pathname: "/admin/restaurants/[id]",
                      params: { id: item.restaurantId },
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
                      <UtensilsCrossed
                        size={17}
                        color={colors.textMuted}
                        strokeWidth={1.8}
                      />
                    </View>
                  )}
                  <View style={styles.cardText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {restaurant?.name ?? "Restaurant"}
                    </Text>
                    {location ? (
                      <Text style={styles.sub} numberOfLines={1}>
                        {location}
                      </Text>
                    ) : null}
                    <Text style={styles.meta} numberOfLines={1}>
                      {claimant ? `@${claimant.username} · ` : ""}
                      {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>
                      {item.role === "owner" ? "Owner" : "Manager"}
                    </Text>
                  </View>
                </Pressable>

                {/* Claim details */}
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Contact</Text>
                  <Text style={styles.detailValue}>{item.contactName}</Text>
                  <Pressable
                    onPress={() =>
                      Linking.openURL(`tel:${item.contactPhone}`).catch(
                        () => {},
                      )
                    }
                  >
                    <Text style={styles.phone}>{item.contactPhone}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      Linking.openURL(`mailto:${item.contactEmail}`).catch(
                        () => {},
                      )
                    }
                  >
                    <Text style={styles.phone}>{item.contactEmail}</Text>
                  </Pressable>
                  {item.proofNote ? (
                    <Text style={styles.note}>“{item.proofNote}”</Text>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => handleApprove(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.approveBtn]}
                    accessibilityRole="button"
                    accessibilityLabel="Approve claim"
                  >
                    {busy ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.onPrimary}
                      />
                    ) : (
                      <>
                        <BadgeCheck
                          size={16}
                          color={colors.onPrimary}
                          strokeWidth={2}
                        />
                        <Text style={styles.approveText}>Approve</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => handleReject(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.rejectBtn]}
                    accessibilityRole="button"
                    accessibilityLabel="Reject claim"
                  >
                    <X size={16} color={colors.error} strokeWidth={2.4} />
                    <Text style={styles.rejectText}>Reject</Text>
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
                <CheckCheck
                  size={30}
                  strokeWidth={1.8}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptyBody}>No claims to review.</Text>
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
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xxxl,
      gap: spacing.sm,
    },
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
      gap: spacing.md,
    },
    cardTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    thumb: {
      width: 48,
      height: 48,
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
    roleBadge: {
      backgroundColor: colors.primaryLight,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    roleBadgeText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.primary,
    },
    detailBlock: {
      backgroundColor: colors.pageBackground,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 2,
    },
    detailLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
    },
    detailValue: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textPrimary,
    },
    phone: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
      marginTop: 2,
    },
    note: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      fontStyle: "italic",
      marginTop: spacing.xs,
      lineHeight: 19,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
    },
    approveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
    },
    approveText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.onPrimary,
    },
    rejectBtn: {
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.errorBg,
    },
    rejectText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.error,
    },
    emptyIconWrap: {
      width: 72,
      height: 72,
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
      textAlign: "center",
    },
    emptyBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
    },
  });
}
