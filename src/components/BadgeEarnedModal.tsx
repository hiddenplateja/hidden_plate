// src/components/BadgeEarnedModal.tsx
// Subtle "new badge earned" celebration shown after a review crosses a tier.
// A centered card with the medal popping in (spring) + a light success haptic.
// Deliberately small and tap-to-continue rather than full-screen confetti.

import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";

import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import { badgeToneColor } from "@/utils/badgeTone";
import type { ReviewerBadge } from "@/utils/reviewerBadges";

interface BadgeEarnedModalProps {
  badges: ReviewerBadge[];
  onClose: () => void;
}

export function BadgeEarnedModal({ badges, onClose }: BadgeEarnedModalProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const multiple = badges.length > 1;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  }, []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View entering={FadeIn.duration(160)} style={styles.cardWrap}>
          {/* Swallow taps on the card so only the backdrop / button close it. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.medalsRow}>
              {badges.map((b, i) => {
                const tc = badgeToneColor(b.tone, colors);
                return (
                  <Animated.View
                    key={b.id}
                    entering={ZoomIn.delay(80 + i * 90).springify().damping(11)}
                    style={[styles.medalHalo, { backgroundColor: tc + "22" }]}
                  >
                    <View style={[styles.medal, { backgroundColor: tc }]}>
                      <b.icon size={30} color={colors.white} strokeWidth={2} />
                    </View>
                  </Animated.View>
                );
              })}
            </View>

            <Text style={styles.title}>
              {multiple ? "New badges earned!" : "New badge earned!"}
            </Text>

            <View style={styles.names}>
              {badges.map((b) => (
                <View key={b.id} style={styles.nameRow}>
                  <Text style={styles.badgeName}>{b.label}</Text>
                  <Text style={styles.badgeReq}>· {b.requirement}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.subtitle}>
              Keep reviewing to climb the ranks.
            </Text>

            <Pressable
              style={styles.button}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Continue"
            >
              <Text style={styles.buttonText}>Continue</Text>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
    },
    cardWrap: { width: "100%", maxWidth: 320 },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: radius.xl,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      ...shadows.md,
    },
    medalsRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    medalHalo: {
      width: 76,
      height: 76,
      borderRadius: 38,
      alignItems: "center",
      justifyContent: "center",
    },
    medal: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.xl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      textAlign: "center",
    },
    names: {
      alignItems: "center",
      marginTop: spacing.sm,
      gap: 2,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "baseline",
      flexWrap: "wrap",
      justifyContent: "center",
    },
    badgeName: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    badgeReq: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginLeft: 4,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: spacing.sm,
    },
    button: {
      marginTop: spacing.lg,
      height: 48,
      width: "100%",
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: {
      fontFamily: fonts.bold,
      fontSize: 16,
      color: colors.onPrimary,
    },
  });
}
