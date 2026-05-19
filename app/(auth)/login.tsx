// app/(auth)/login.tsx
// Login screen.
//
// Layout (top to bottom):
//   - Brand header
//   - Sign in with Apple (iOS only — App Store guideline 4.8 if other OAuth used)
//   - Sign in with Google
//   - Divider
//   - Email + password form
//   - "Don't have an account? Sign up" link
//
// UX details:
//   - KeyboardAvoidingView lifts form above keyboard on iOS
//   - keyboardShouldPersistTaps="handled" so taps on buttons work with keyboard up
//   - textContentType + autoComplete enable iOS QuickType + password manager
//   - Email "next" focuses password; password "done" submits

import { Link } from "expo-router";
import { useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { colors, spacing, typography } from "@/theme/colors";

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
      await loginWithGoogle();
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
      await loginWithApple();
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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.brand}>Hidden Plate</Text>
            <Text style={styles.tagline}>
              Discover Jamaica&apos;s best-kept food secrets
            </Text>
          </View>

          {Platform.OS === "ios" ? (
            <Button
              label="Continue with Apple"
              onPress={handleApple}
              variant="secondary"
              loading={submitting === "apple"}
              disabled={anyBusy && submitting !== "apple"}
              style={styles.oauthButton}
            />
          ) : null}

          <Button
            label="Continue with Google"
            onPress={handleGoogle}
            variant="secondary"
            loading={submitting === "google"}
            disabled={anyBusy && submitting !== "google"}
            style={styles.oauthButton}
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

          <Button
            label="Sign in"
            onPress={handleEmailLogin}
            loading={submitting === "email"}
            disabled={anyBusy && submitting !== "email"}
            style={styles.submitButton}
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account? </Text>
            <Link href="/(auth)/signup" replace style={styles.footerLink}>
              Sign up
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  kav: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  brand: {
    ...typography.h1,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
  oauthButton: {
    marginBottom: spacing.sm,
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
    ...typography.caption,
    color: colors.textMuted,
    marginHorizontal: spacing.md,
    textTransform: "uppercase",
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.xl,
  },
  footerText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  footerLink: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
});
