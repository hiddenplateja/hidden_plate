// src/components/auth/AuthHeader.tsx
// Shared brand header for the auth screens — an ink brand tile above a
// left-aligned title and optional subtitle. Used by login and the signup
// landing so the two entry points read as the same product.

import { UtensilsCrossed } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface AuthHeaderProps {
  title: string;
  subtitle?: string;
}

export function AuthHeader({ title, subtitle }: AuthHeaderProps) {
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <View style={styles.block}>
      <View style={styles.logoTile}>
        <UtensilsCrossed size={26} color={colors.onPrimary} strokeWidth={2.2} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    block: { alignItems: "flex-start" },
    logoTile: {
      width: 56,
      height: 56,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
    },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.title,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      lineHeight: 34,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      marginTop: spacing.sm,
      lineHeight: 22,
    },
  });
}
