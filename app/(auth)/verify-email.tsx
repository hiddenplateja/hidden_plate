// app/(auth)/verify-email.tsx
// Existing-user gate — when an authenticated user's email isn't verified, the
// root layout routes them here. Reuses the same email-keyed OTP flow as signup:
// send a code to the account email, verify it, then mark the account verified.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OtpForm } from "@/components/auth/OtpForm";
import { useAuth } from "@/hooks/useAuth";
import {
  confirmEmailVerified,
  sendEmailOtp,
  verifyEmailOtp,
} from "@/services/auth";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function VerifyEmailScreen() {
  const { user, refresh, logout } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);
  const email = user?.email ?? "";

  const onResend = useCallback(async () => {
    await sendEmailOtp(email);
  }, [email]);

  const onVerify = useCallback(
    async (code: string) => {
      await verifyEmailOtp(email, code);
      await confirmEmailVerified();
      // emailVerified flips true → the root gate routes into the app.
      await refresh();
    },
    [email, refresh],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons
              name="email-check-outline"
              size={34}
              color={colors.primary}
            />
          </View>
          <Text style={styles.title}>Verify your email</Text>

          {email ? (
            <OtpForm
              email={email}
              onVerify={onVerify}
              onResend={onResend}
              autoSend
            />
          ) : null}
        </View>

        <Pressable
          onPress={() => logout()}
          style={styles.signOut}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>Wrong email? Sign out</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    kav: { flex: 1 },
    content: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xxxl,
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
      marginBottom: spacing.sm,
    },
    signOut: { alignItems: "center", paddingVertical: spacing.lg },
    signOutText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
  });
}
