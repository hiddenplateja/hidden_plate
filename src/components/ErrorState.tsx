// src/components/ErrorState.tsx
// Reusable error UI for failed loads or actions.
//
// Two variants:
//   "screen" — full-bleed centered layout, used when an entire screen
//     failed to load (e.g. community feed couldn't fetch reviews).
//   "inline" — compact block that sits inside a larger layout when one
//     section failed but others succeeded (e.g. comments errored but the
//     parent review loaded fine).
//
// Both support an optional retry button. Pass `onRetry` to show it. Omit
// when there's nothing useful to retry (e.g. a save action failed and the
// caller is showing the error transiently before the user moves on).
//
// Tone of voice: friendly, not technical. Never surface raw error
// messages from network/SDK calls — they're confusing and sometimes
// expose internal details. Pass a curated `title` and `body` instead.

import { CircleAlert, RotateCw, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface ErrorStateProps {
  /** Layout variant — full-screen empty state, or inline block within content. */
  variant?: "screen" | "inline";
  /** Short headline, e.g. "Couldn't load reviews". User-facing. */
  title?: string;
  /** One-line explanation, e.g. "Check your connection and try again." */
  body?: string;
  /** Show a retry button. If omitted, no button is rendered. */
  onRetry?: () => void;
  /** Label on the retry button. Defaults to "Try again". */
  retryLabel?: string;
  /**
   * Icon to display (a Lucide component). Defaults to a generic alert circle.
   * Pick something topical when it helps (e.g. CloudOff for network errors).
   */
  icon?: LucideIcon;
}

export function ErrorState({
  variant = "screen",
  title = "Something went wrong",
  body = "Please try again.",
  onRetry,
  retryLabel = "Try again",
  icon: Icon = CircleAlert,
}: ErrorStateProps) {
  const isScreen = variant === "screen";
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <View style={isScreen ? styles.screenContainer : styles.inlineContainer}>
      <Icon
        size={isScreen ? 44 : 30}
        color={colors.textMuted}
        strokeWidth={1.8}
      />
      <Text style={isScreen ? styles.screenTitle : styles.inlineTitle}>
        {title}
      </Text>
      {body ? (
        <Text style={isScreen ? styles.screenBody : styles.inlineBody}>
          {body}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            isScreen ? styles.screenRetryBtn : styles.inlineRetryBtn,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
        >
          <RotateCw size={15} color={colors.onPrimary} strokeWidth={2.2} />
          <Text style={styles.retryBtnText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // ── Screen variant ────────────────────────────────────────────────────
  // Centered, takes the full height of its container. Use as the screen's
  // sole child when a top-level fetch failed.
  screenContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.huge,
    gap: spacing.sm,
  },
  screenTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  screenBody: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  screenRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.lg,
  },

  // ── Inline variant ────────────────────────────────────────────────────
  // Sits inside a larger layout. Smaller icon, less vertical padding,
  // tighter typography. Doesn't try to fill its parent.
  inlineContainer: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  inlineTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  inlineBody: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 240,
  },
  inlineRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    marginTop: spacing.sm,
  },

  retryBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.onPrimary,
  },
  pressed: { opacity: 0.7 },
  });
}
