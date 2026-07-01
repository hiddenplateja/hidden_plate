// src/components/ui/Input.tsx
// Text input primitive with label, error state, and focus chain support.
//
// Notes:
//  - forwardRef so screens can call .focus() on the next input from
//    onSubmitEditing (the "next" key on the keyboard)
//  - autoComplete + textContentType pass through so iOS/Android can offer
//    password manager + QuickType suggestions — important for store quality
//  - error and helperText are mutually exclusive (error wins)
//  - password fields (secureTextEntry) get an eye toggle to reveal/hide

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { forwardRef, useState } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    type TextInputProps,
} from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  helperText?: string;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, helperText, style, onFocus, onBlur, secureTextEntry, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const { styles, colors } = useThemedStyles(makeStyles);

  const isPassword = !!secureTextEntry;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.field}>
        <TextInput
          ref={ref}
          style={[
            styles.input,
            isPassword && styles.inputWithToggle,
            focused && styles.inputFocused,
            error && styles.inputError,
            style,
          ]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPassword ? hidden : undefined}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            style={styles.toggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
          >
            <MaterialCommunityIcons
              name={hidden ? "eye-outline" : "eye-off-outline"}
              size={22}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
});

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  field: {
    position: "relative",
    justifyContent: "center",
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputWithToggle: {
    paddingRight: 48,
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  inputError: {
    borderColor: colors.error,
    backgroundColor: colors.errorBg,
  },
  toggle: {
    position: "absolute",
    right: 4,
    height: 44,
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.error,
    marginTop: spacing.xs,
  },
  helperText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  });
}
