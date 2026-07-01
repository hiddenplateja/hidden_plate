// app/(auth)/signup.tsx
// Signup landing — pick a method: Apple / Google (wired later) or email.
// Email kicks off the verify-first wizard (email → OTP → profile).

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Link, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthHeader } from "@/components/auth/AuthHeader";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { type OAuthResult } from "@/services/auth";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

type SocialBusy = "google" | "apple" | null;

export default function SignupLandingScreen() {
  const router = useRouter();
  const { loginWithGoogle, loginWithApple } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [busy, setBusy] = useState<SocialBusy>(null);

  const runOAuth = async (
    which: "google" | "apple",
    fn: () => Promise<OAuthResult>,
  ) => {
    setBusy(which);
    try {
      const res = await fn();
      if (res.status === "needs-username") {
        // New account → collect a username before creating the profile.
        // Cast through unknown: typed-routes hasn't regenerated the new route
        // into its union yet (it does so on dev-server start) — the route exists.
        router.push({
          pathname: "/(auth)/oauth-username",
          params: {
            username: res.suggestedUsername,
            displayName: res.suggestedDisplayName,
            photoUrl: res.photoUrl ?? undefined,
          },
        } as unknown as Href);
      }
      // else authenticated → root layout redirect handles navigation.
    } catch (err) {
      Alert.alert(
        which === "google" ? "Google sign-in" : "Apple sign-in",
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.content}>
        <AuthHeader
          title="Create your account"
          subtitle="Join the community finding Jamaica's best plates."
        />

        <View style={styles.actions}>
          <SocialAuthButtons
            onApple={() => runOAuth("apple", loginWithApple)}
            onGoogle={() => runOAuth("google", loginWithGoogle)}
            busy={busy}
            disabled={busy !== null}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Button
            label="Continue with email"
            onPress={() => router.push("/(auth)/signup-email")}
            leftIcon={
              <MaterialCommunityIcons
                name="email-outline"
                size={20}
                color={colors.white}
              />
            }
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" replace style={styles.footerLink}>
            Sign in
          </Link>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    content: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xxxl,
      paddingBottom: spacing.xl,
      justifyContent: "space-between",
    },
    actions: { width: "100%" },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: spacing.lg,
    },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginHorizontal: spacing.md,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
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
