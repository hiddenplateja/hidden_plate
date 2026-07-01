// app/(auth)/signup-otp.tsx
// Wizard step 2 — enter the code we emailed. The code was already sent by the
// email step, so OtpForm doesn't auto-send (just starts its cooldown). On
// success we move to the profile step.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { StepDots } from "@/components/auth/StepDots";
import { sendEmailOtp, verifyEmailOtp } from "@/services/auth";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function SignupOtpScreen() {
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = (emailParam ?? "").toLowerCase();
  const { styles, colors } = useThemedStyles(makeStyles);

  const onVerify = useCallback(
    async (code: string) => {
      await verifyEmailOtp(email, code);
      router.push({ pathname: "/(auth)/signup-profile", params: { email } });
    },
    [email, router],
  );

  const onResend = useCallback(async () => {
    await sendEmailOtp(email);
  }, [email]);

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
          <StepDots total={3} index={1} />
          <View style={styles.iconBtn} />
        </View>

        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons
              name="email-check-outline"
              size={34}
              color={colors.primary}
            />
          </View>
          <Text style={styles.title}>Check your inbox</Text>

          <OtpForm email={email} onVerify={onVerify} onResend={onResend} />

          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.wrongEmail}
          >
            <Text style={styles.wrongEmailText}>Wrong email? Go back</Text>
          </Pressable>
        </View>
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
    content: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
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
    wrongEmail: { alignItems: "center", paddingVertical: spacing.lg },
    wrongEmailText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
  });
}
