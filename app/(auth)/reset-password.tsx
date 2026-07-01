// app/(auth)/reset-password.tsx
// Reset step 2 — the user pastes the 6-digit code we emailed and picks a new
// password. resetPassword() sends both to the worker, which verifies the code
// and sets the password with its admin key in one atomic call. On success we
// bounce back to login so they can sign in with the new password.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { StepDots } from "@/components/auth/StepDots";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { requestPasswordReset, resetPassword } from "@/services/auth";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const RESEND_COOLDOWN = 30;

interface FieldErrors {
  password?: string;
  confirmPassword?: string;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = (emailParam ?? "").toLowerCase();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A code was just sent by the previous screen, so start the cooldown now to
  // avoid an instant resend → server rate-limit.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const clearError = (field: keyof FieldErrors) =>
    setErrors((p) => (p[field] ? { ...p, [field]: undefined } : p));

  const validate = () => {
    if (code.length !== 6) {
      setFormError("Enter the 6-digit code we emailed you.");
      return false;
    }
    const next: FieldErrors = {};
    if (!password) next.password = "Password is required";
    else if (password.length < 8) next.password = "At least 8 characters";

    if (!confirmPassword) next.confirmPassword = "Please re-enter your password";
    else if (password && confirmPassword !== password)
      next.confirmPassword = "Passwords don't match";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleReset = async () => {
    if (!email) {
      Alert.alert("Something went wrong", "Missing email — please start again.");
      router.replace("/(auth)/forgot-password");
      return;
    }
    if (!validate()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await resetPassword(email, code, password);
      Alert.alert(
        "Password reset",
        "Your password has been updated. Sign in with your new password.",
      );
      router.replace("/(auth)/login");
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Couldn't reset your password. Try again.",
      );
      setCode("");
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending || !email) return;
    setResending(true);
    setFormError(null);
    try {
      await requestPasswordReset(email);
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Couldn't resend the code.",
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={colors.textPrimary}
          />
        </Pressable>
        <StepDots total={2} index={1} />
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <Text style={styles.title}>Create a new password</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to{"\n"}
          <Text style={styles.email}>{email}</Text>
        </Text>

        <TextInput
          style={[styles.codeInput, formError ? styles.codeInputError : null]}
          value={code}
          onChangeText={(t) => {
            setFormError(null);
            setCode(t.replace(/\D/g, "").slice(0, 6));
          }}
          placeholder="••••••"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          editable={!submitting}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          accessibilityLabel="Reset code"
        />

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <View style={styles.resendRow}>
          <Text style={styles.resendText}>Didn&apos;t get the code? </Text>
          {cooldown > 0 ? (
            <Text style={styles.resendMuted}>Resend in {cooldown}s</Text>
          ) : (
            <Pressable onPress={handleResend} disabled={resending} hitSlop={8}>
              <Text style={styles.resendLink}>
                {resending ? "Sending…" : "Resend"}
              </Text>
            </Pressable>
          )}
        </View>

        <Input
          ref={passwordRef}
          label="New password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            clearError("password");
            clearError("confirmPassword");
          }}
          placeholder="At least 8 characters"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          blurOnSubmit={false}
          error={errors.password}
          editable={!submitting}
        />

        <Input
          ref={confirmRef}
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={(t) => {
            setConfirmPassword(t);
            clearError("confirmPassword");
          }}
          placeholder="Re-enter your password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleReset}
          error={errors.confirmPassword}
          editable={!submitting}
        />

        <Button
          label="Reset password"
          onPress={handleReset}
          loading={submitting}
          style={styles.cta}
        />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    flex: { flex: 1 },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
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
      marginBottom: spacing.xl,
      lineHeight: 22,
    },
    email: { fontFamily: fonts.bold, color: colors.textPrimary },
    codeInput: {
      width: "100%",
      height: 64,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.pageBackground,
      textAlign: "center",
      fontFamily: fonts.black,
      fontSize: 30,
      letterSpacing: 10,
      color: colors.textPrimary,
    },
    codeInputError: {
      borderColor: colors.error,
      backgroundColor: colors.errorBg,
    },
    formError: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.error,
      marginTop: spacing.sm,
      textAlign: "center",
    },
    resendRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.md,
      marginBottom: spacing.xl,
    },
    resendText: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    resendMuted: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
    resendLink: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    cta: { marginTop: spacing.sm },
  });
}
