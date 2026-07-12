// app/badges.tsx
// Full-screen reviewer-badge guide — the tier ladder for both tracks (review
// volume + parish coverage), what earns each tier, and where the user stands.
//
// Reached two ways:
//   - tapping a badge on a profile (?userId=<that profile's user>)
//   - the "Reviewer Badges" item in the profile menu (own — no param)
//
// Progress ("N more to the next tier") only shows for your OWN badges.

import { ArrowLeft, CircleCheck, Lock } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { getUserReviewStats } from "@/services/reviews";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import { badgeToneColor } from "@/utils/badgeTone";
import {
  getBadgeLadder,
  getNextBadgeProgress,
  type BadgeProgress,
  type LadderTier,
  type ReviewerBadgeStats,
} from "@/utils/reviewerBadges";

export default function BadgesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const targetId = userIdParam ?? user?.id ?? null;
  const showProgress = !!targetId && targetId === user?.id;
  const { styles, colors } = useThemedStyles(makeStyles);

  const [stats, setStats] = useState<ReviewerBadgeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!targetId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await getUserReviewStats(targetId);
        if (!cancelled) {
          setStats({
            reviewCount: s.reviewCount,
            parishesVisited: s.parishesVisited,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const tracks = stats ? getBadgeLadder(stats) : [];
  const progress = stats && showProgress ? getNextBadgeProgress(stats) : [];

  return (
    <View style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
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
          <Text style={styles.headerTitle}>Reviewer Badges</Text>
          <View style={{ width: 36 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.intro}>
              Earn these as you review spots and explore Jamaica. Your highest
              tier on each track shows on your profile.
            </Text>

            {tracks.map((track) => {
              const unit = track.value === 1 ? track.unit : `${track.unit}s`;
              const prog = progress.find((p) => p.unit === track.unit);
              return (
                <View key={track.id} style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionTitle}>{track.title}</Text>
                    <Text style={styles.sectionValue}>
                      {track.value} {unit}
                    </Text>
                  </View>
                  {prog ? <TrackProgress progress={prog} /> : null}
                  {track.tiers.map((tier) => (
                    <TierRow key={tier.badge.id} tier={tier} />
                  ))}
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function TrackProgress({ progress: p }: { progress: BadgeProgress }) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const tc = badgeToneColor(p.badge.tone, colors);
  const pct = Math.min(100, Math.round((p.current / p.target) * 100));
  const unit = p.remaining === 1 ? p.unit : `${p.unit}s`;

  return (
    <View style={styles.trackProgress}>
      <Text style={styles.trackProgressText}>
        <Text style={styles.trackProgressStrong}>
          {p.remaining} more {unit}
        </Text>{" "}
        to {p.badge.label}
      </Text>
      <View style={styles.trackProgressTrack}>
        <View
          style={[
            styles.trackProgressFill,
            { width: `${pct}%`, backgroundColor: tc },
          ]}
        />
      </View>
    </View>
  );
}

function TierRow({ tier }: { tier: LadderTier }) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const tc = badgeToneColor(tier.badge.tone, colors);

  return (
    <View
      style={[
        styles.row,
        tier.isCurrent && {
          backgroundColor: tc + "14",
          borderColor: tc + "33",
        },
      ]}
    >
      <View
        style={[
          styles.medal,
          { backgroundColor: tier.earned ? tc : colors.pageBackground },
          !tier.earned && { borderWidth: 1, borderColor: colors.divider },
        ]}
      >
        <tier.badge.icon
          size={20}
          color={tier.earned ? colors.white : colors.textMuted}
          strokeWidth={2}
        />
      </View>

      <View style={styles.rowText}>
        <View style={styles.rowLabelLine}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {tier.badge.label}
          </Text>
          {tier.isCurrent ? (
            <View style={[styles.currentPill, { backgroundColor: tc }]}>
              <Text style={styles.currentPillText}>Current</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowReq} numberOfLines={1}>
          {tier.badge.requirement}
        </Text>
      </View>

      {tier.earned ? (
        <CircleCheck size={20} color={colors.success} strokeWidth={2} />
      ) : (
        <Lock size={20} color={colors.textMuted} strokeWidth={2} />
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.md,
      backgroundColor: colors.cardBackground,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
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
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.huge,
    },
    intro: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    section: { marginBottom: spacing.xl },
    sectionHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
    },
    sectionValue: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textSecondary,
    },
    trackProgress: {
      gap: 5,
      marginBottom: spacing.sm,
    },
    trackProgressText: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
    trackProgressStrong: {
      fontFamily: fonts.bold,
      color: colors.textSecondary,
    },
    trackProgressTrack: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.divider,
      overflow: "hidden",
    },
    trackProgressFill: {
      height: "100%",
      borderRadius: radius.pill,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: "transparent",
      marginBottom: spacing.xs,
    },
    medal: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1, gap: 1 },
    rowLabelLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    rowLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    currentPill: {
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 1,
    },
    currentPillText: {
      fontFamily: fonts.bold,
      fontSize: 10,
      color: colors.white,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    rowReq: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
  });
}
