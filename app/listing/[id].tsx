// app/listing/[id].tsx
// Owner-facing "keep your listing active" screen. Claimed restaurants need an
// active listing window to stay visible in discovery; this is where the owner
// buys/renews it (a one-time period via RevenueCat). Mirrors the Promote screen.

import {
  ArrowLeft,
  CircleCheck,
  ClockAlert,
  EyeOff,
  Info,
  Lock,
  type LucideIcon,
} from "lucide-react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
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
import { PAID_FEATURES_ENABLED } from "@/constants/features";
import { useAuth } from "@/hooks/useAuth";
import { formatPrice } from "@/services/featuring";
import {
  getListingPlans,
  listingPaymentConfigured,
  listingStatus,
  startListingCheckout,
  type ListingPlan,
  type ListingStatus,
} from "@/services/listing";
import { getRestaurantById } from "@/services/restaurants";
import { captureError } from "@/services/sentry";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; restaurant: Restaurant; plans: ListingPlan[] };

const PERKS = [
  "Keep your restaurant visible in search & discovery",
  "Keep your verified-owner badge",
  "Reply to reviews and run featured promotions",
];

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-JM", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Paid listing renewal is gated off for the free launch. No UI links here, but
// a deep link could still land on the route — bounce back to the restaurant.
export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!PAID_FEATURES_ENABLED) return <Redirect href={`/restaurant/${id}`} />;
  return <ListingScreenInner />;
}

function ListingScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [load, setLoad] = useState<Load>({ status: "loading" });
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
          getListingPlans(),
        ]);
        if (active) setLoad({ status: "ready", restaurant, plans });
      } catch (err) {
        captureError(err, { screen: "listing", op: "load", restaurantId: id });
        if (active) setLoad({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const handlePay = useCallback(async () => {
    if (load.status !== "ready") return;
    const restaurant = load.restaurant;
    const plan = load.plans[0];
    if (!plan?.productId || !user?.id) return;

    if (!listingPaymentConfigured()) {
      Alert.alert(
        "Almost there",
        "Payments are being set up. We'll let you know the moment listing renewals go live — thanks for your patience!",
      );
      return;
    }

    setPaying(true);
    try {
      const res = await startListingCheckout(
        restaurant.id,
        plan.productId,
        user.id,
      );
      if (res.status === "success") {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const fresh = await getRestaurantById(restaurant.id);
          setLoad({ status: "ready", restaurant: fresh, plans: load.plans });
        } catch {
          /* best-effort refresh */
        }
        Alert.alert(
          "Listing active 🎉",
          "Thanks! Your restaurant stays listed. If the date doesn't update right away, give it a minute.",
        );
      } else if (res.status === "failed") {
        Alert.alert(
          "Purchase didn't complete",
          "You haven't been charged. Please try again.",
        );
      }
    } catch (err) {
      captureError(err, {
        screen: "listing",
        op: "checkout",
        restaurantId: restaurant.id,
      });
      Alert.alert("Something went wrong", "Please try again in a moment.");
    } finally {
      setPaying(false);
    }
  }, [load, user]);

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
          <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.headerTitle}>Your listing</Text>
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
            <Lock size={30} color={colors.textPrimary} strokeWidth={1.8} />
          </View>
          <Text style={styles.stateTitle}>Owners only</Text>
          <Text style={styles.stateBody}>
            Only the verified owner can manage this listing.
          </Text>
        </View>
      ) : (
        <ListingBody
          styles={styles}
          colors={colors}
          restaurant={load.restaurant}
          plan={load.plans[0]}
          paying={paying}
          onPay={handlePay}
        />
      )}
    </SafeAreaView>
  );
}

interface BodyProps {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  restaurant: Restaurant;
  plan: ListingPlan | undefined;
  paying: boolean;
  onPay: () => void;
}

function statusCopy(s: ListingStatus): {
  icon: LucideIcon;
  text: string;
  tone: "ok" | "warn" | "bad";
} {
  switch (s.state) {
    case "active":
      return {
        icon: CircleCheck,
        text: s.until ? `Listed until ${fmtDate(s.until)}` : "Your listing is active",
        tone: "ok",
      };
    case "grandfathered":
      return { icon: CircleCheck, text: "Your listing is active", tone: "ok" };
    case "expiring":
      return {
        icon: ClockAlert,
        text: s.until
          ? `Expires ${fmtDate(s.until)} — renew to stay listed`
          : "Expiring soon — renew to stay listed",
        tone: "warn",
      };
    case "lapsed":
      return {
        icon: EyeOff,
        text: "Your listing is hidden — renew to restore it",
        tone: "bad",
      };
    default:
      return {
        icon: Info,
        text: "Activate your listing to stay visible",
        tone: "warn",
      };
  }
}

function ListingBody({ styles, colors, restaurant, plan, paying, onPay }: BodyProps) {
  const status = listingStatus(restaurant);
  const sc = statusCopy(status);
  const live = listingPaymentConfigured();
  const renewing = status.state === "active" || status.state === "expiring";
  const tint =
    sc.tone === "ok"
      ? colors.primary
      : sc.tone === "warn"
        ? colors.warning
        : colors.error;

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.restaurantName}>{restaurant.name}</Text>

      <View style={[styles.statusBanner, { borderColor: tint }]}>
        <sc.icon size={17} color={tint} strokeWidth={2} />
        <Text style={styles.statusText}>{sc.text}</Text>
      </View>

      <Text style={styles.blurb}>
        Hidden Plate is free for diners. Claimed restaurants keep an active
        listing with a simple yearly fee — that keeps you visible and unlocks
        your owner tools.
      </Text>

      <View style={styles.perks}>
        {PERKS.map((perk) => (
          <View key={perk} style={styles.perkRow}>
            <CircleCheck size={16} color={colors.success} strokeWidth={2.2} />
            <Text style={styles.perkText}>{perk}</Text>
          </View>
        ))}
      </View>

      {plan ? (
        <View style={styles.planCard}>
          <View style={styles.planText}>
            <Text style={styles.planLabel}>{plan.label} listing</Text>
            <Text style={styles.planSub}>
              Keeps your restaurant listed for {plan.days} days
            </Text>
          </View>
          <Text style={styles.planPrice}>
            {formatPrice(plan.amount, plan.currency)}
          </Text>
        </View>
      ) : null}

      <View style={styles.submitWrap}>
        <Button
          label={renewing ? "Renew listing" : "Activate listing"}
          onPress={onPay}
          disabled={!plan}
          loading={paying}
        />
        {!live ? (
          <Text style={styles.comingSoon}>
            💳 Payments are being set up — check back soon.
          </Text>
        ) : null}
        <Text style={styles.fineprint}>
          A receipt is sent to your email. Your listing stays active for the full
          period from the date of purchase.
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
      borderRadius: 18,
      backgroundColor: colors.surface,
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
      backgroundColor: colors.surface,
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
      marginBottom: spacing.lg,
    },
    statusText: {
      flex: 1,
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textPrimary,
    },
    blurb: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: spacing.lg,
    },
    perks: { gap: spacing.sm, marginBottom: spacing.xl },
    perkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    perkText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
    },
    planCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    planText: { flex: 1, gap: 2 },
    planLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
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
