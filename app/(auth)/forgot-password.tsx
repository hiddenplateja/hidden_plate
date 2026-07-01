// app/(auth)/forgot-password.tsx
// Reset step 1 — collect the email and ask the worker to send a reset code.
// On success we move to the reset step (code + new password). The worker
// rejects emails with no account; we surface that inline.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StepDots } from "@/components/auth/StepDots";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { requestPasswordReset } from "@/services/auth";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleContinue = async () => {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setError("Enter a valid email address");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(value);
      router.push({
        pathname: "/(auth)/reset-password",
        params: { email: value },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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
          <StepDots total={2} index={0} />
          <View style={styles.iconBtn} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons
              name="lock-reset"
              size={34}
              color={colors.primary}
            />
          </View>

          <Text style={styles.title}>Forgot your password?</Text>
          <Text style={styles.subtitle}>
            Enter your email and we&apos;ll send a 6-digit code to reset it.
          </Text>

          <Input
            label="Email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (error) setError(null);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleContinue}
            error={error}
            editable={!submitting}
          />

          <Button
            label="Send reset code"
            onPress={handleContinue}
            loading={submitting}
            style={styles.cta}
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Remembered it? </Text>
            <Link href="/(auth)/login" replace style={styles.footerLink}>
              Back to sign in
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    kav: { flex: 1 },
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
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
      alignItems: "center",
    },
    iconWrap: {
      width: 76,
      height: 76,
      borderRadius: radius.pill,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
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
      paddingHorizontal: spacing.md,
    },
    cta: { marginTop: spacing.sm },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xl,
    },
    footerText: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    footerLink: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
  });
}
