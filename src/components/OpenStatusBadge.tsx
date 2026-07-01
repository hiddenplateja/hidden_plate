// src/components/OpenStatusBadge.tsx
// Small open/closed indicator driven by a restaurant's OpeningHours. Renders
// nothing when the status is unknown (no hours), so callers can drop it in
// unconditionally.
//   - "full"    → dot + "Open · closes 9 PM" / "Closed · opens 8 AM"
//   - "compact" → dot + "Open" / "Closed"

import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import type { OpeningHours } from "@/types/restaurant";
import { getOpenStatus } from "@/utils/openStatus";

interface OpenStatusBadgeProps {
  hours: OpeningHours | null | undefined;
  variant?: "full" | "compact";
  /** Inject a clock for tests / fixed renders. Defaults to now. */
  now?: Date;
  style?: StyleProp<ViewStyle>;
}

export function OpenStatusBadge({
  hours,
  variant = "full",
  now,
  style,
}: OpenStatusBadgeProps) {
  const { colors } = useTheme();
  const status = useMemo(() => getOpenStatus(hours, now), [hours, now]);

  if (status.state === "unknown") return null;

  const open = status.state === "open";
  const color = open ? colors.success : colors.textMuted;
  const text = variant === "compact" ? status.short : status.label;

  return (
    <View style={[styles.row, style]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
  },
});
