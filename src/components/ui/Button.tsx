// src/components/ui/Button.tsx
// Reusable button primitive.
//
// Why a custom component:
//  - Consistent loading state (spinner replaces label, no layout shift)
//  - Disabled state both visual and accessible
//  - Variants enforce design system
//  - One place to fix accessibility for every button in the app

import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
    type PressableProps,
    type StyleProp,
    type ViewStyle,
} from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

type Variant = "primary" | "secondary" | "outline" | "ghost";

interface ButtonProps extends Omit<PressableProps, "style"> {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  leftIcon,
  fullWidth = true,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? colors.onPrimary : colors.primary}
          size="small"
        />
      ) : (
        <View style={styles.content}>
          {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
          <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  base: {
    height: 54,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  fullWidth: {
    width: "100%",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    marginRight: spacing.sm,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 16,
    letterSpacing: T.tracking.snug,
  },

  // Variants
  primary: {
    backgroundColor: colors.primary,
  },
  primaryLabel: {
    color: colors.onPrimary,
  },
  secondary: {
    backgroundColor: colors.surface,
  },
  secondaryLabel: {
    color: colors.text,
  },
  outline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  outlineLabel: {
    color: colors.primary,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  ghostLabel: {
    color: colors.primary,
  },

  // States
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  });
}
