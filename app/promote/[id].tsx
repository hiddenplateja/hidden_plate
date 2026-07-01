// app/promote/[id].tsx
// Owner-facing "feature my restaurant" screen: shows current featured status
// and the plans (priced from app_config). Choosing a plan + paying runs the
// WiPay checkout via the Cloudflare Worker (startFeatureCheckout). Until the
// worker URL is configured, the pay action explains card payments are being
// set up.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import {
  featuredStatus,
  formatPrice,
  getFeaturePlans,
  paymentConfigured,
  startFeatureCheckout,
  type FeaturePlan,
} from "@/services/featuring";
import { getRestaurantById } from "@/services/restaurants";
import { captureError } from "@/services/sentry";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; restaurant: Restaurant; plans: FeaturePlan[] };

const PERKS = [
  "Appear in the Discover “Featured” carousel",
  "Rank higher across the app",
  "A verified-owner badge on your listing",
];

export default function PromoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoad({ status: "error" });
      return;
    }
    let active = true;
    (async () => {
      try {
        const [restaurant, plans] = await Promise.all([
          getRestaurantById(id),
          getFeaturePlans(),
        ]);
        if (!active) return;
        setLoad({ status: "ready", restaurant, plans });
        // Default to the badged plan ("Best value") or the first one.
        const preferred = plans.find((p) => p.badge) ?? plans[0];
        setSelected(preferred?.id ?? null);
      } catch (err) {
        captureError(err, { screen: "promote", op: "load", restaurantId: id });
        if (active) setLoad({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const handlePay = useCallback(async () => {
    if (!paymentConfigured()) {
      Alert.alert(
        "Almost there",
        "Card payments are being set up. We'll let you know the moment promotion goes live — thanks for your patience!",
      );
      return;
    }
    if (load.status !== "ready" || !selected) return;
    const restaurant = load.restaurant;
    const plan = load.plans.find((p) => p.id === selected);
    if (!plan?.productId || !user?.id) return;
    setPaying(true);
    try {
      const res = await startFeatureCheckout(
        restaurant.id,
        plan.productId,
        user.id,
      );
      if (res.status === "success") {
        // The worker activates the feature via webhook a few seconds after the
        // store confirms. Give it a moment, then refetch the status banner.
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const fresh = await getRestaurantById(restaurant.id);
          setLoad({ status: "ready", restaurant: fresh, plans: load.plans });
        } catch {
          /* banner refresh is best-effort */
        }
        Alert.alert(
          "You're featured! 🎉",
          "Thanks for promoting your restaurant. If it doesn't show right away, give it a minute to activate.",
        );
      } else if (res.status === "failed") {
        Alert.alert(
          "Purchase didn't complete",
          "You haven't been charged. Please try again.",
        );
      }
      // "cancelled" → stay quiet; the user dismissed the store sheet.
    } catch (err) {
      captureError(err, {
        screen: "promote",
        op: "checkout",
        restaurantId: restaurant.id,
      });
      Alert.alert("Something went wrong", "Please try again in a moment.");
    } finally {
      setPaying(false);
    }
  }, [load, selected, user]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
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
        <Text style={styles.headerTitle}>Promote</Text>
        <View style={{ width: 36 }} />
      </View>

      {load.status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : load.status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.stateTitle}>Couldn&apos;t load this restaurant</Text>
          <Text style={styles.stateBody}>
            Check your connection and try again.
          </Text>
        </View>
      ) : load.restaurant.ownerId !== user?.id ? (
        <View style={styles.center}>
          <View style={styles.noticeIcon}>
            <MaterialCommunityIcons
              name="account-lock-outline"
              size={32}
              color={colors.primary}
            />
          </View>
          <Text style={styles.stateTitle}>Owners only</Text>
          <Text style={styles.stateBody}>
            Only the verified owner can promote this restaurant.
          </Text>
        </View>
      ) : (
        <PromoteBody
          styles={styles}
          colors={colors}
          restaurant={load.restaurant}
          plans={load.plans}
          selected={selected}
          onSelect={setSelected}
          onPay={handlePay}
          paying={paying}
        />
      )}
    </SafeAreaView>
  );
}

interface BodyProps {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  restaurant: Restaurant;
  plans: FeaturePlan[];
  selected: string | null;
  onSelect: (id: string) => void;
  onPay: () => void;
  paying: boolean;
}

function PromoteBody({
  styles,
  colors,
  restaurant,
  plans,
  selected,
  onSelect,
  onPay,
  paying,
}: BodyProps) {
  const status = featuredStatus(restaurant.isFeatured, restaurant.featuredUntil);
  const paymentLive = paymentConfigured();

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.restaurantName}>{restaurant.name}</Text>

      {/* Current status */}
      <View
        style={[styles.statusBanner, status.active && styles.statusBannerActive]}
      >
        <MaterialCommunityIcons
          name={status.active ? "star-check" : "star-outline"}
          size={18}
          color={status.active ? colors.primary : colors.textMuted}
        />
        <Text style={styles.statusText}>
          {status.active
            ? status.until
              ? `Featured until ${status.until.toLocaleDateString("en-JM", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : "Currently featured"
            : "Not currently featured"}
        </Text>
      </View>

      {/* Perks */}
      <View style={styles.perks}>
        {PERKS.map((perk) => (
          <View key={perk} style={styles.perkRow}>
            <MaterialCommunityIcons
              name="check-circle"
              size={16}
              color={colors.primary}
            />
            <Text style={styles.perkText}>{perk}</Text>
          </View>
        ))}
      </View>

      {/* Plans */}
      <Text style={styles.sectionLabel}>Choose a plan</Text>
      <View style={styles.plans}>
        {plans.map((plan) => {
          const active = selected === plan.id;
          return (
            <Pressable
              key={plan.id}
              onPress={() => onSelect(plan.id)}
              style={[styles.planCard, active && styles.planCardActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[styles.radio, active && styles.radioActive]}
              >
                {active ? (
                  <MaterialCommunityIcons
                    name="check"
                    size={13}
                    color={colors.textInverse}
                  />
                ) : null}
              </View>
              <View style={styles.planText}>
                <View style={styles.planTitleRow}>
                  <Text style={styles.planLabel}>{plan.label}</Text>
                  {plan.badge ? (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{plan.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.planSub}>
                  Featured for {plan.days} days
                </Text>
              </View>
              <Text style={styles.planPrice}>
                {formatPrice(plan.amount, plan.currency)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.submitWrap}>
        <Button
          label="Continue to payment"
          onPress={onPay}
          disabled={!selected}
          loading={paying}
        />
        {!paymentLive ? (
          <Text style={styles.comingSoon}>
            💳 Card payments are being set up — check back soon.
          </Text>
        ) : null}
        <Text style={styles.fineprint}>
          You&apos;ll get a receipt by email. Promotion starts as soon as
          payment is confirmed.
        </Text>
      </View>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
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
    noticeIcon: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    stateTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
      color: colors.textPrimary,
      textAlign: "center",
    },
    stateBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
    },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
    restaurantName: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      marginBottom: spacing.md,
    },
    statusBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.lg,
    },
    statusBannerActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    statusText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textPrimary,
    },
    perks: { gap: spacing.sm, marginBottom: spacing.xl },
    perkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    perkText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
    },
    sectionLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
      marginBottom: spacing.sm,
    },
    plans: { gap: spacing.sm },
    planCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.cardBackground,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    planCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    planText: { flex: 1, gap: 2 },
    planTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    planLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    planBadge: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    planBadgeText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textInverse,
    },
    planSub: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    planPrice: {
      fontFamily: fonts.black,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
    submitWrap: { marginTop: spacing.xl, gap: spacing.sm },
    comingSoon: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      textAlign: "center",
    },
    fineprint: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 17,
    },
  });
}
