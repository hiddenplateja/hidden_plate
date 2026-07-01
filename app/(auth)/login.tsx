// app/(auth)/login.tsx
// Login screen.
//
// Layout (top to bottom):
//   - Brand header (shared AuthHeader)
//   - Sign in with Apple (iOS only) + Google (shared SocialAuthButtons)
//   - Divider
//   - Email + password form (password has a show/hide toggle)
//   - "Don't have an account? Sign up" link pinned to the bottom
//
// UX details:
//   - KeyboardAwareScrollView lifts the focused field above the keyboard
//   - keyboardShouldPersistTaps="handled" so taps on buttons work with keyboard up
//   - textContentType + autoComplete enable iOS QuickType + password manager
//   - Email "next" focuses password; password "done" submits

import { Link, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthHeader } from "@/components/auth/AuthHeader";
import { ContinueAsButton } from "@/components/auth/ContinueAsButton";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { passwordResetEnabled, type OAuthResult } from "@/services/auth";
import {
  clearLastOAuth,
  getLastOAuth,
  type LastOAuth,
} from "@/services/lastOAuth";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

type SubmittingState = null | "email" | "google" | "apple";
type LoginErrors = { email?: string; password?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const { login, loginWithGoogle, loginWithApple } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [submitting, setSubmitting] = useState<SubmittingState>(null);

  const passwordRef = useRef<TextInput>(null);
  const router = useRouter();
  const { styles } = useThemedStyles(makeStyles);
  const resetEnabled = passwordResetEnabled();

  // Last OAuth identity (persisted on-device) → "Continue as …" shortcut.
  const [lastOAuth, setLastOAuth] = useState<LastOAuth | null>(null);
  useEffect(() => {
    let active = true;
    getLastOAuth().then((v) => {
      if (active) setLastOAuth(v);
    });
    return () => {
      active = false;
    };
  }, []);

  // Swipe-away on the card forgets the saved identity.
  const handleDismissLastOAuth = () => {
    clearLastOAuth();
    setLastOAuth(null);
  };

  // New OAuth accounts have no profile yet → route to the username picker.
  // Cast: typed-routes generates the route union at dev-server start, so a
  // freshly-added route isn't in it until the next regen — the route is real.
  const routeIfNeedsUsername = (res: OAuthResult) => {
    if (res.status === "needs-username") {
      router.push({
        pathname: "/(auth)/oauth-username",
        params: {
          username: res.suggestedUsername,
          displayName: res.suggestedDisplayName,
          photoUrl: res.photoUrl ?? undefined,
        },
      } as unknown as Href);
    }
  };

  const validate = () => {
    const next: LoginErrors = {};

    if (!email.trim()) {
      next.email = "Email is required";
    } else if (!EMAIL_RE.test(email.trim())) {
      next.email = "Enter a valid email address";
    }

    if (!password) {
      next.password = "Password is required";
    } else if (password.length < 8) {
      next.password = "Password must be at least 8 characters";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleEmailLogin = async () => {
    if (!validate()) return;
    setSubmitting("email");
    try {
      await login({ email: email.trim().toLowerCase(), password });
      // Root layout redirect handles navigation
    } catch (err) {
      Alert.alert(
        "Sign in failed",
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const handleGoogle = async () => {
    setSubmitting("google");
    try {
      routeIfNeedsUsername(await loginWithGoogle());
    } catch (err) {
      Alert.alert(
        "Google sign-in",
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const handleApple = async () => {
    setSubmitting("apple");
    try {
      routeIfNeedsUsername(await loginWithApple());
    } catch (err) {
      Alert.alert(
        "Apple sign-in",
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const anyBusy = submitting !== null;
  const socialBusy =
    submitting === "apple" ? "apple" : submitting === "google" ? "google" : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <AuthHeader
          title="Welcome back"
          subtitle="Sign in to keep discovering Jamaica's hidden plates."
        />

        <View style={styles.actions}>
          {lastOAuth ? (
            <ContinueAsButton
              identity={lastOAuth}
              loading={submitting === lastOAuth.provider}
              disabled={anyBusy}
              onPress={() =>
                lastOAuth.provider === "google" ? handleGoogle() : handleApple()
              }
              onDismiss={handleDismissLastOAuth}
            />
          ) : null}

          <SocialAuthButtons
            onApple={handleApple}
            onGoogle={handleGoogle}
            busy={socialBusy}
            disabled={submitting === "email"}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Input
            label="Email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (errors.email) {
                setErrors((p) => ({ ...p, email: undefined }));
              }
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            blurOnSubmit={false}
            error={errors.email}
            editable={!anyBusy}
          />

          <Input
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (errors.password) {
                setErrors((p) => ({ ...p, password: undefined }));
              }
            }}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={handleEmailLogin}
            error={errors.password}
            editable={!anyBusy}
          />

          {resetEnabled ? (
            <View style={styles.forgotRow}>
              <Link href="/(auth)/forgot-password" style={styles.forgotLink}>
                Forgot password?
              </Link>
            </View>
          ) : null}

          <Button
            label="Sign in"
            onPress={handleEmailLogin}
            loading={submitting === "email"}
            disabled={anyBusy && submitting !== "email"}
            style={styles.submitButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don&apos;t have an account? </Text>
          <Link href="/(auth)/signup" replace style={styles.footerLink}>
            Sign up
          </Link>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.cardBackground,
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xxl,
      paddingBottom: spacing.xl,
    },
    actions: {
      width: "100%",
      marginTop: spacing.xl,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: spacing.lg,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginHorizontal: spacing.md,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
    },
    forgotRow: {
      alignItems: "flex-end",
      marginTop: -spacing.xs,
      marginBottom: spacing.md,
    },
    forgotLink: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    submitButton: {
      marginTop: spacing.sm,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: "auto",
      paddingTop: spacing.xl,
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
