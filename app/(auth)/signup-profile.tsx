// app/(auth)/signup-profile.tsx
// Wizard step 3 — the email is verified; collect name + username + password and
// create the account. signup() also marks the new account verified server-side,
// so the root gate lets the user straight into the app.
//
// Keyboard: uses KeyboardAwareScrollView (react-native-keyboard-controller) so
// the focused field always scrolls above the keyboard on both platforms.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { StepDots } from "@/components/auth/StepDots";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

interface FieldErrors {
  displayName?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
}

export default function SignupProfileScreen() {
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = (emailParam ?? "").toLowerCase();
  const { signup } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const validate = () => {
    const next: FieldErrors = {};
    const dn = displayName.trim();
    if (!dn) next.displayName = "Name is required";
    else if (dn.length < 2) next.displayName = "At least 2 characters";
    else if (dn.length > 50) next.displayName = "At most 50 characters";

    const un = username.trim().toLowerCase();
    if (!un) next.username = "Username is required";
    else if (!USERNAME_RE.test(un))
      next.username = "3–20 chars: lowercase letters, numbers, underscore";

    if (!password) next.password = "Password is required";
    else if (password.length < 8) next.password = "At least 8 characters";

    if (!confirmPassword) next.confirmPassword = "Please re-enter your password";
    else if (password && confirmPassword !== password)
      next.confirmPassword = "Passwords don't match";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const clearError = (field: keyof FieldErrors) =>
    setErrors((p) => (p[field] ? { ...p, [field]: undefined } : p));

  const handleCreate = async () => {
    if (!email) {
      Alert.alert("Something went wrong", "Missing email — please start again.");
      router.replace("/(auth)/signup");
      return;
    }
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signup({
        email,
        password,
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
      });
      // Root layout redirect handles navigation (account is already verified).
    } catch (err) {
      Alert.alert(
        "Couldn't create account",
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
      setSubmitting(false);
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
        <StepDots total={3} index={2} />
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <View style={styles.verifiedChip}>
          <MaterialCommunityIcons
            name="check-circle"
            size={18}
            color={colors.success}
          />
          <Text style={styles.verifiedText} numberOfLines={1}>
            {email} verified
          </Text>
        </View>

        <Text style={styles.title}>Set up your profile</Text>
        <Text style={styles.subtitle}>
          This is how you&apos;ll show up in the community.
        </Text>

        <Input
          label="Name"
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
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
          error={errors.username}
          helperText={
            !errors.username
              ? "Lowercase, 3–20 chars. Letters, numbers, underscore."
              : undefined
          }
          editable={!submitting}
        />

        <Input
          ref={passwordRef}
          label="Password"
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
          onSubmitEditing={() => confirmPasswordRef.current?.focus()}
          blurOnSubmit={false}
          error={errors.password}
          editable={!submitting}
        />

        <Input
          ref={confirmPasswordRef}
          label="Confirm password"
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
          onSubmitEditing={handleCreate}
          error={errors.confirmPassword}
          editable={!submitting}
        />

        <Button
          label="Create account"
          onPress={handleCreate}
          loading={submitting}
          style={styles.cta}
        />

        <Text style={styles.terms}>
          By creating an account you agree to our Terms of Service and Privacy
          Policy.
        </Text>
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
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
    verifiedChip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      maxWidth: "100%",
      backgroundColor: colors.primaryLight,
      borderRadius: radius.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.lg,
    },
    verifiedText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.success,
      marginLeft: spacing.xs,
      flexShrink: 1,
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
    terms: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textAlign: "center",
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      lineHeight: 18,
    },
  });
}
