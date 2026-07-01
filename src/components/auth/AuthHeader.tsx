// src/components/auth/AuthHeader.tsx
// Shared brand header for the auth screens — a coral-tinted logo tile above a
// title and optional subtitle. Used by login and the signup landing so the two
// entry points read as the same product.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { fonts, radius, shadows, spacing, typographyTokens as T } from "@/theme/colors";
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
        <MaterialCommunityIcons
          name="silverware-fork-knife"
          size={32}
          color={colors.primary}
        />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    block: { alignItems: "center" },
    logoTile: {
      width: 72,
      height: 72,
      borderRadius: radius.xl,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
      ...shadows.sm,
    },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      textAlign: "center",
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: spacing.sm,
      lineHeight: 22,
      paddingHorizontal: spacing.md,
    },
  });
}
