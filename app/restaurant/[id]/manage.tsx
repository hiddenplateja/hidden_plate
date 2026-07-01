// app/restaurant/[id]/manage.tsx
// Owner dashboard for a single restaurant. Reached from "Your Restaurants".
// Owner-only (gated on ownerId). Shows live stats + the things an owner can
// actually do — edit the menu, reply to reviews, view their public page, and
// manage their listing. Restaurant details (name/address/hours/photos) stay
// admin-managed (owners can't write the restaurant doc), so we point those at
// "contact an admin".

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { listingStatus } from "@/services/listing";
import { getRestaurantById } from "@/services/restaurants";
import { getRestaurantViewCount } from "@/services/restaurantViews";
import { getRestaurantReviewStats } from "@/services/reviews";
import { getImagePreviewUrl } from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";

interface Action {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
}

export default function ManageRestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [stats, setStats] = useState<{ count: number; average: number } | null>(
    null,
  );
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await getRestaurantById(id);
        if (!active) return;
        setRestaurant(r);
        // Stats + views are best-effort; the dashboard renders without them.
        getRestaurantReviewStats(id)
          .then((s) => active && setStats(s))
          .catch(() => {});
        getRestaurantViewCount(id)
          .then((v) => active && setViews(v))
          .catch(() => {});
      } catch {
        if (active) setRestaurant(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Owner-only. (The underlying writes are permissioned server-side regardless.)
  if (!restaurant || !user?.id || user.id !== restaurant.ownerId) {
    return <Redirect href={`/restaurant/${id}`} />;
  }

  const coverId = restaurant.coverImageId ?? restaurant.imageIds[0] ?? null;
  const thumb = coverId ? getImagePreviewUrl(coverId) : null;
  const listing = listingStatus(restaurant);
  const rating = stats ? stats.average : restaurant.averageRating;
  const reviewCount = stats ? stats.count : restaurant.reviewCount;
  const needsRenew = listing.state === "lapsed" || listing.state === "expiring";

  const actions: Action[] = [
    {
      icon: "silverware-fork-knife",
      label: "Edit menu",
      sub: "Add sections and dishes",
      onPress: () => router.push(`/restaurant/${id}/edit-menu`),
    },
    {
      icon: "star-outline",
      label: "Reviews",
      sub: "Read and reply to reviews",
      onPress: () => router.push(`/restaurant/${id}/reviews`),
    },
    {
      icon: "open-in-new",
      label: "View public page",
      sub: "See your restaurant as customers do",
      onPress: () => router.push(`/restaurant/${id}`),
    },
    {
      icon: "receipt-text-outline",
      label: "Manage listing",
      sub: "Renew or check your listing window",
      onPress: () => router.push(`/listing/${id}`),
    },
  ];

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
        <Text style={styles.headerTitle}>Manage</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <View style={styles.idRow}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <MaterialCommunityIcons
                name="silverware-fork-knife"
                size={22}
                color={colors.textMuted}
              />
            </View>
          )}
          <View style={styles.idText}>
            <Text style={styles.name} numberOfLines={2}>
              {restaurant.name}
            </Text>
            {restaurant.isFeatured ? (
              <View style={styles.featuredPill}>
                <MaterialCommunityIcons
                  name="star"
                  size={11}
                  color={colors.primary}
                />
                <Text style={styles.featuredText}>Featured</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <Stat label="Rating" value={reviewCount > 0 ? rating.toFixed(1) : "—"} />
          <Stat
            label={reviewCount === 1 ? "Review" : "Reviews"}
            value={String(reviewCount)}
          />
          <Stat label="Views" value={views == null ? "—" : String(views)} />
        </View>

        {/* Listing warning */}
        {needsRenew ? (
          <Pressable
            style={styles.banner}
            onPress={() => router.push(`/listing/${id}`)}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={18}
              color={colors.error}
            />
            <Text style={styles.bannerText}>
              {listing.state === "lapsed"
                ? "Your listing has lapsed and is hidden from discovery. Tap to renew."
                : `Your listing expires soon${
                    listing.daysLeft != null
                      ? ` (${listing.daysLeft} days left)`
                      : ""
                  }. Tap to renew.`}
            </Text>
          </Pressable>
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          {actions.map((a, i) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={({ pressed }) => [
                styles.actionRow,
                i < actions.length - 1 && styles.actionRowBorder,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={a.label}
            >
              <View style={styles.actionIcon}>
                <MaterialCommunityIcons
                  name={a.icon}
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionLabel}>{a.label}</Text>
                <Text style={styles.actionSub} numberOfLines={1}>
                  {a.sub}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          ))}
        </View>

        <Text style={styles.note}>
          To update your name, address, hours, or photos, contact the Hidden
          Plate team — those details are managed by admins.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.pageBackground },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
    content: { padding: spacing.screen, paddingBottom: spacing.huge },
    idRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    thumb: {
      width: 64,
      height: 64,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    idText: { flex: 1, gap: 4 },
    name: {
      fontFamily: fonts.black,
      fontSize: T.size.xl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    featuredPill: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 3,
      backgroundColor: colors.primaryLight,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.full,
    },
    featuredText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.primary,
    },
    statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
    statCard: {
      flex: 1,
      backgroundColor: colors.cardBackground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      paddingVertical: spacing.md,
      alignItems: "center",
      gap: 2,
    },
    statValue: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    statLabel: {
      fontFamily: fonts.medium,
      fontSize: T.size.xs,
      color: colors.textMuted,
    },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.errorBg,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    bannerText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.error,
      lineHeight: 18,
    },
    actions: {
      backgroundColor: colors.cardBackground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      overflow: "hidden",
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    actionRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    actionIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    actionText: { flex: 1 },
    actionLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    actionSub: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textSecondary,
      marginTop: 1,
    },
    note: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      lineHeight: 17,
      marginTop: spacing.lg,
      paddingHorizontal: spacing.xs,
    },
    pressed: { backgroundColor: colors.pageBackground },
  });
}
