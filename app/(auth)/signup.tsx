// app/(auth)/signup.tsx
// Signup screen — display name, username, email, password.

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

interface FieldErrors {
  displayName?: string;
  username?: string;
  email?: string;
  password?: string;
}

export default function SignupScreen() {
  const { signup } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const validate = () => {
    const next: FieldErrors = {};

    const dn = displayName.trim();
    if (!dn) next.displayName = "Display name is required";
    else if (dn.length < 2) next.displayName = "At least 2 characters";
    else if (dn.length > 50) next.displayName = "At most 50 characters";

    const un = username.trim().toLowerCase();
    if (!un) next.username = "Username is required";
    else if (!USERNAME_RE.test(un))
      next.username = "3–20 chars, lowercase letters, numbers, underscore only";

    if (!email.trim()) next.email = "Email is required";
    else if (!EMAIL_RE.test(email.trim()))
      next.email = "Enter a valid email address";

    if (!password) next.password = "Password is required";
    else if (password.length < 8)
      next.password = "Password must be at least 8 characters";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const clearError = (field: keyof FieldErrors) => {
    setErrors((p) => (p[field] ? { ...p, [field]: undefined } : p));
  };

  const handleSignup = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signup({
        email: email.trim().toLowerCase(),
        password,
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
      });
    } catch (err) {
      Alert.alert(
        "Sign up failed",
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>
              Join the community finding Jamaica&apos;s best plates.
            </Text>
          </View>

          <Input
            label="Display name"
            value={displayName}
            onChangeText={(t) => {
              setDisplayName(t);
              clearError("displayName");
            }}
            placeholder="What others will see"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => usernameRef.current?.focus()}
            blurOnSubmit={false}
            error={errors.displayName}
            editable={!submitting}
          />

          <Input
            ref={usernameRef}
            label="Username"
            value={username}
            onChangeText={(t) => {
              setUsername(t.toLowerCase().replace(/\s/g, ""));
              clearError("username");
            }}
            placeholder="e.g. tasty_explorer"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            blurOnSubmit={false}
            error={errors.username}
            helperText={
              !errors.username
                ? "Lowercase, 3–20 characters. Letters, numbers, underscore."
                : undefined
            }
            editable={!submitting}
          />

          <Input
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              clearError("email");
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
            editable={!submitting}
          />

          <Input
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              clearError("password");
            }}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password-new"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={handleSignup}
            error={errors.password}
            editable={!submitting}
          />

          <Button
            label="Create account"
            onPress={handleSignup}
            loading={submitting}
            style={styles.submitButton}
          />

          <Text style={styles.terms}>
            By creating an account you agree to our Terms of Service and Privacy
            Policy.
          </Text>

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
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  terms: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.lg,
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
