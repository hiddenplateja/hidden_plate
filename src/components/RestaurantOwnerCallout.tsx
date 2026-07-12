// src/components/RestaurantOwnerCallout.tsx
// The owner/claim affordance on the restaurant detail screen. Renders one of:
//   - "You manage this listing" (you're the verified owner)
//   - "Verified owner" badge (someone else owns it — social proof for everyone)
//   - "Claim under review" (you have a pending claim)
//   - "Own this business? Claim it" CTA (unclaimed + signed in)
//   - nothing (unclaimed + signed out)
//
// Self-contained: fetches the viewer's claim status on focus so returning from
// the claim form reflects the pending state without the parent re-plumbing.

import {
  BadgeCheck,
  ChevronRight,
  CircleCheck,
  Clock,
  ClockAlert,
  EyeOff,
  Megaphone,
  Store,
  type LucideIcon,
} from "lucide-react-native";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  claimsEnabled,
  getMyClaimForRestaurant,
  type ClaimStatus,
} from "@/services/claims";
import { listingStatus, type ListingState } from "@/services/listing";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";

interface Props {
  restaurant: Restaurant;
  currentUserId: string | null;
  onClaim: () => void;
  /** Owner-only: open the Promote (featured placement) screen. */
  onPromote?: () => void;
  /** Owner-only: open the manage-listing (keep-listed) screen. */
  onManageListing?: () => void;
}

// Compact listing-status label for the owner card.
function listingLabel(state: ListingState): {
  icon: LucideIcon;
  text: string;
  tone: "ok" | "warn" | "bad";
} | null {
  switch (state) {
    case "active":
    case "grandfathered":
      return { icon: CircleCheck, text: "Listing active", tone: "ok" };
    case "expiring":
      return {
        icon: ClockAlert,
        text: "Listing expires soon — renew",
        tone: "warn",
      };
    case "lapsed":
      return {
        icon: EyeOff,
        text: "Listing hidden — renew now",
        tone: "bad",
      };
    default:
      return null;
  }
}

export function RestaurantOwnerCallout({
  restaurant,
  currentUserId,
  onClaim,
  onPromote,
  onManageListing,
}: Props) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);

  const ownedByMe =
    !!restaurant.ownerId && restaurant.ownerId === currentUserId;
  const ownedByOther =
    !!restaurant.ownerId && restaurant.ownerId !== currentUserId;
  // Only relevant when unclaimed, signed in, and the feature is configured.
  const canClaim = !restaurant.ownerId && !!currentUserId && claimsEnabled();
  const needClaimState = canClaim;

  useFocusEffect(
    useCallback(() => {
      if (!needClaimState) {
        setClaimStatus(null);
        return;
      }
      let active = true;
      getMyClaimForRestaurant(restaurant.id)
        .then((c) => {
          if (active) setClaimStatus(c?.status ?? null);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [needClaimState, restaurant.id]),
  );

  if (ownedByMe) {
    const listing = listingLabel(listingStatus(restaurant).state);
    const listingTint = listing
      ? listing.tone === "ok"
        ? colors.primary
        : listing.tone === "warn"
          ? colors.warning
          : colors.error
      : colors.primary;
    return (
      <View style={styles.ownerCard}>
        <View style={styles.ownerCardRow}>
          <BadgeCheck size={19} color={colors.primary} strokeWidth={2} />
          <View style={styles.textWrap}>
            <Text style={styles.title}>You manage this listing</Text>
            <Text style={styles.sub}>
              You&apos;re the verified owner of this restaurant.
            </Text>
          </View>
        </View>
        {onManageListing && listing ? (
          <Pressable
            onPress={onManageListing}
            style={({ pressed }) => [
              styles.listingRow,
              { borderColor: listingTint },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Manage your listing"
          >
            <listing.icon size={15} color={listingTint} strokeWidth={2} />
            <Text style={[styles.listingText, { color: listingTint }]}>
              {listing.text}
            </Text>
            <ChevronRight size={17} color={listingTint} strokeWidth={2} />
          </Pressable>
        ) : null}
        {onPromote ? (
          <Pressable
            onPress={onPromote}
            style={({ pressed }) => [
              styles.promoteBtn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Promote this restaurant"
          >
            <Megaphone size={15} color={colors.onPrimary} strokeWidth={2} />
            <Text style={styles.promoteText}>Promote this restaurant</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (ownedByOther) {
    return (
      <View style={styles.badgeRow}>
        <BadgeCheck size={14} color={colors.primary} strokeWidth={2} />
        <Text style={styles.badgeText}>Verified owner</Text>
      </View>
    );
  }

  if (canClaim) {
    if (claimStatus === "pending") {
      return (
        <View style={[styles.card, styles.pendingCard]}>
          <Clock size={19} color={colors.textMuted} strokeWidth={2} />
          <View style={styles.textWrap}>
            <Text style={styles.title}>Claim under review</Text>
            <Text style={styles.sub}>
              We&apos;re reviewing your claim for this restaurant.
            </Text>
          </View>
        </View>
      );
    }
    return (
      <Pressable
        style={({ pressed }) => [styles.claimRow, pressed && styles.pressed]}
        onPress={onClaim}
        accessibilityRole="button"
        accessibilityLabel="Claim this business"
      >
        <Store size={17} color={colors.primary} strokeWidth={2} />
        <Text style={styles.claimText}>
          Own this business? <Text style={styles.claimTextBold}>Claim it</Text>
        </Text>
        <ChevronRight size={17} color={colors.textMuted} strokeWidth={2} />
      </Pressable>
    );
  }

  return null;
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginHorizontal: spacing.screen,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
    },
    ownerCard: {
      marginHorizontal: spacing.screen,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
      gap: spacing.md,
    },
    ownerCardRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    promoteBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    promoteText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.onPrimary,
    },
    listingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      backgroundColor: colors.cardBackground,
    },
    listingText: {
      flex: 1,
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
    },
    pendingCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    textWrap: { flex: 1 },
    title: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    sub: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textSecondary,
      marginTop: 1,
      lineHeight: 17,
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginHorizontal: spacing.screen,
      marginTop: spacing.md,
    },
    badgeText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    claimRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.screen,
      marginTop: spacing.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    claimText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    claimTextBold: {
      fontFamily: fonts.bold,
      color: colors.primary,
    },
    pressed: { opacity: 0.7 },
  });
}
