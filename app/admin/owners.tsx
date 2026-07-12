// app/admin/owners.tsx
// Admin: every user who has claimed a restaurant, with the restaurants they
// own. Grouped by owner; shows contact details from their approved claim and
// each restaurant's listing status (active / expiring / hidden). Tap a
// restaurant to open its admin edit screen, tap the owner to view their profile.

import {
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  Mail,
  Phone,
  UserCheck,
  UtensilsCrossed,
} from "lucide-react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { Avatar } from "@/components/Avatar";
import { listClaims, type RestaurantClaim } from "@/services/claims";
import { listingStatus, type ListingState } from "@/services/listing";
import { listClaimedRestaurants } from "@/services/restaurants";
import { getImagePreviewUrl } from "@/services/storage";
import { getUsersByIds } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import type { User } from "@/types/user";
import { getLocationLine } from "@/utils/restaurantDisplay";

interface OwnerGroup {
  userId: string;
  user: User | null;
  claim: RestaurantClaim | null;
  restaurants: Restaurant[];
}

function listingPill(state: ListingState): {
  text: string;
  tone: "ok" | "warn" | "bad";
} | null {
  switch (state) {
    case "active":
    case "grandfathered":
      return { text: "Active", tone: "ok" };
    case "expiring":
      return { text: "Expiring", tone: "warn" };
    case "lapsed":
      return { text: "Hidden", tone: "bad" };
    default:
      return null;
  }
}

export default function AdminOwners() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [claims, setClaims] = useState<Map<string, RestaurantClaim>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const owned = await listClaimedRestaurants();
      setRestaurants(owned);
      setError(null);

      const ownerIds = Array.from(
        new Set(owned.map((r) => r.ownerId).filter((id): id is string => !!id)),
      );
      if (ownerIds.length > 0) {
        getUsersByIds(ownerIds)
          .then(setUsers)
          .catch(() => {});
        // Approved claims carry the owner's contact details. Newest first, so
        // the first claim seen per user is their latest.
        listClaims({ status: "approved", pageSize: 100 })
          .then((page) => {
            const byUser = new Map<string, RestaurantClaim>();
            for (const c of page.items) {
              if (!byUser.has(c.userId)) byUser.set(c.userId, c);
            }
            setClaims(byUser);
          })
          .catch(() => {});
      }
    } catch (err) {
      setRestaurants([]);
      setError(err instanceof Error ? err.message : "Couldn't load owners.");
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

  const groups = useMemo<OwnerGroup[]>(() => {
    const byOwner = new Map<string, Restaurant[]>();
    for (const r of restaurants) {
      if (!r.ownerId) continue;
      const list = byOwner.get(r.ownerId) ?? [];
      list.push(r);
      byOwner.set(r.ownerId, list);
    }
    return Array.from(byOwner.entries()).map(([userId, rests]) => ({
      userId,
      user: users.get(userId) ?? null,
      claim: claims.get(userId) ?? null,
      restaurants: rests,
    }));
  }, [restaurants, users, claims]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Owners" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.userId}
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
          renderItem={({ item }) => (
            <View style={styles.card}>
              {/* Owner header */}
              <Pressable
                style={styles.ownerRow}
                onPress={() =>
                  router.push({
                    pathname: "/profile/[id]",
                    params: { id: item.userId },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`View ${
                  item.user?.displayName ?? "owner"
                }'s profile`}
              >
                <Avatar
                  fileId={item.user?.avatarUrl ?? null}
                  displayName={item.user?.displayName ?? "?"}
                  userId={item.userId}
                  size={44}
                />
                <View style={styles.ownerText}>
                  <Text style={styles.ownerName} numberOfLines={1}>
                    {item.user?.displayName ?? "Unknown user"}
                  </Text>
                  <Text style={styles.ownerSub} numberOfLines={1}>
                    {item.user ? `@${item.user.username} · ` : ""}
                    {item.restaurants.length}{" "}
                    {item.restaurants.length === 1 ? "restaurant" : "restaurants"}
                  </Text>
                </View>
                <BadgeCheck size={18} color={colors.primary} strokeWidth={2} />
              </Pressable>

              {/* Contact (from their approved claim) */}
              {item.claim ? (
                <View style={styles.contactRow}>
                  <Pressable
                    onPress={() =>
                      Linking.openURL(`tel:${item.claim?.contactPhone}`).catch(
                        () => {},
                      )
                    }
                    style={styles.contactChip}
                    accessibilityRole="button"
                  >
                    <Phone size={13} color={colors.primary} strokeWidth={2} />
                    <Text style={styles.contactText} numberOfLines={1}>
                      {item.claim.contactPhone}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `mailto:${item.claim?.contactEmail}`,
                      ).catch(() => {})
                    }
                    style={styles.contactChip}
                    accessibilityRole="button"
                  >
                    <Mail size={13} color={colors.primary} strokeWidth={2} />
                    <Text style={styles.contactText} numberOfLines={1}>
                      {item.claim.contactEmail}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Their restaurants */}
              <View style={styles.restList}>
                {item.restaurants.map((r) => {
                  const coverId = r.coverImageId ?? r.imageIds[0] ?? null;
                  const thumb = coverId ? getImagePreviewUrl(coverId) : null;
                  const location = getLocationLine(r);
                  const pill = listingPill(listingStatus(r).state);
                  const tint =
                    pill?.tone === "ok"
                      ? colors.primary
                      : pill?.tone === "warn"
                        ? colors.warning
                        : colors.error;
                  return (
                    <Pressable
                      key={r.id}
                      style={({ pressed }) => [
                        styles.restRow,
                        pressed && styles.pressed,
                      ]}
                      onPress={() =>
                        router.push({
                          pathname: "/admin/restaurants/[id]",
                          params: { id: r.id },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Manage ${r.name}`}
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
                            size={16}
                            color={colors.textMuted}
                            strokeWidth={1.8}
                          />
                        </View>
                      )}
                      <View style={styles.restText}>
                        <Text style={styles.restName} numberOfLines={1}>
                          {r.name}
                        </Text>
                        {location ? (
                          <Text style={styles.restSub} numberOfLines={1}>
                            {location}
                          </Text>
                        ) : null}
                      </View>
                      {pill ? (
                        <View style={[styles.pill, { borderColor: tint }]}>
                          <Text style={[styles.pillText, { color: tint }]}>
                            {pill.text}
                          </Text>
                        </View>
                      ) : null}
                      <ChevronRight
                        size={17}
                        color={colors.textMuted}
                        strokeWidth={2}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIconWrap}>
                {error ? (
                  <CircleAlert size={30} color={colors.primary} strokeWidth={1.8} />
                ) : (
                  <UserCheck size={30} color={colors.primary} strokeWidth={1.8} />
                )}
              </View>
              <Text style={styles.emptyTitle}>
                {error ? "Couldn't load owners" : "No owners yet"}
              </Text>
              <Text style={styles.emptyBody}>
                {error ??
                  "When you approve a restaurant claim, the owner shows up here."}
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
      flexGrow: 1,
    },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: spacing.md,
      gap: spacing.md,
    },
    ownerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    ownerText: { flex: 1, gap: 2 },
    ownerName: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    ownerSub: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
    },
    contactRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    contactChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      maxWidth: "100%",
    },
    contactText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.primary,
      flexShrink: 1,
    },
    restList: {
      backgroundColor: colors.pageBackground,
      borderRadius: radius.md,
      overflow: "hidden",
    },
    restRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    pressed: { opacity: 0.7 },
    thumb: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    restText: { flex: 1, gap: 1 },
    restName: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textPrimary,
    },
    restSub: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textSecondary,
    },
    pill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.full,
      borderWidth: 1,
    },
    pillText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
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
      lineHeight: 22,
    },
  });
}
