// app/(auth)/signup-email.tsx
// Wizard step 1 — collect the email and send the first OTP. On success we move
// to the OTP step; the worker rejects emails that already have an account.

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
import { sendEmailOtp } from "@/services/auth";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupEmailScreen() {
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
      await sendEmailOtp(value);
      router.push({ pathname: "/(auth)/signup-otp", params: { email: value } });
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
          <StepDots total={3} index={0} />
          <View style={styles.iconBtn} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>What&apos;s your email?</Text>
          <Text style={styles.subtitle}>
            We&apos;ll send a 6-digit code to verify it&apos;s really you.
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
            label="Continue"
            onPress={handleContinue}
            loading={submitting}
            style={styles.cta}
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/login" replace style={styles.footerLink}>
              Sign in
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
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
    },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
      lineHeight: 22,
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
