// app/my-restaurants.tsx
// "Your restaurants" — the listings the signed-in user owns (claim approved).
// Uses getOwnedRestaurants(), which ignores the discovery date-filter, so an
// owner can always reach a LAPSED (hidden) listing here to renew it.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { listingStatus, type ListingState } from "@/services/listing";
import { getOwnedRestaurants } from "@/services/restaurants";
import { getImagePreviewUrl } from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import { getLocationLine } from "@/utils/restaurantDisplay";

function statusPill(state: ListingState): {
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

export default function MyRestaurants() {
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [items, setItems] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const owned = await getOwnedRestaurants(user.id);
      setItems(owned);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
        <Text style={styles.headerTitle}>Your Restaurants</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
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
          renderItem={({ item }) => {
            const coverId = item.coverImageId ?? item.imageIds[0] ?? null;
            const thumb = coverId ? getImagePreviewUrl(coverId) : null;
            const location = getLocationLine(item);
            const pill = statusPill(listingStatus(item).state);
            const tint =
              pill?.tone === "ok"
                ? colors.primary
                : pill?.tone === "warn"
                  ? colors.warning
                  : colors.error;
            const needsRenew =
              pill?.tone === "warn" || pill?.tone === "bad";
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.cardPressed,
                ]}
                onPress={() =>
                  router.push({
                    pathname: "/restaurant/[id]/manage",
                    params: { id: item.id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Manage ${item.name}`}
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
                      size={20}
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
                  {pill ? (
                    <View style={styles.pillRow}>
                      <View style={[styles.pill, { borderColor: tint }]}>
                        <Text style={[styles.pillText, { color: tint }]}>
                          {pill.text}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                {needsRenew ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/listing/[id]",
                        params: { id: item.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.renewBtn,
                      pressed && styles.cardPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Renew listing for ${item.name}`}
                  >
                    <Text style={styles.renewText}>Renew</Text>
                  </Pressable>
                ) : (
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.textMuted}
                  />
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="storefront-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>No restaurants yet</Text>
              <Text style={styles.emptyBody}>
                Find your restaurant in the app and tap “Own this business? Claim
                it.” Once approved, it shows up here.
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    backBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
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
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.cardBackground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: spacing.md,
    },
    cardPressed: { opacity: 0.7 },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    cardText: { flex: 1, gap: 3 },
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
    pillRow: { flexDirection: "row", marginTop: 2 },
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
    renewBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    renewText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textInverse,
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
