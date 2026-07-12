// app/(auth)/oauth-username.tsx
// Shown right after a first-time Google/Apple sign-in: the OAuth session exists
// but there's no profile yet. Collect a username (+ confirm the display name),
// then create the profile via completeOAuthSignup. Cancelling signs out so the
// user isn't left with a session and no profile.

import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoundCheck, X } from "lucide-react-native";
import { useRef, useState } from "react";
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

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { validateDisplayName, validateUsername } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface FieldErrors {
  displayName?: string;
  username?: string;
}

export default function OAuthUsernameScreen() {
  const router = useRouter();
  const { completeOAuthSignup, logout } = useAuth();
  const {
    username: usernameParam,
    displayName: displayNameParam,
    photoUrl: photoUrlParam,
  } = useLocalSearchParams<{
    username?: string;
    displayName?: string;
    photoUrl?: string;
  }>();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [displayName, setDisplayName] = useState(displayNameParam ?? "");
  const [username, setUsername] = useState((usernameParam ?? "").toLowerCase());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const usernameRef = useRef<TextInput>(null);

  const clearError = (field: keyof FieldErrors) =>
    setErrors((p) => (p[field] ? { ...p, [field]: undefined } : p));

  const validate = () => {
    const next: FieldErrors = {};
    const nameErr = validateDisplayName(displayName);
    if (nameErr) next.displayName = nameErr;
    const userErr = validateUsername(username);
    if (userErr) next.username = userErr;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await completeOAuthSignup({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        photoUrl: photoUrlParam ?? null,
      });
      // Root layout redirect handles navigation (→ onboarding).
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      // A taken username comes back as a message — show it inline on the field.
      if (/username/i.test(msg)) {
        setErrors((p) => ({ ...p, username: msg }));
      } else {
        Alert.alert("Couldn't finish", msg);
      }
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel sign-in?",
      "You'll be signed out and can start again.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "Cancel",
          style: "destructive",
          onPress: () => {
            logout().catch(() => {});
            router.replace("/(auth)/signup");
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={handleCancel} hitSlop={10} style={styles.backBtn}>
          <X size={21} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <View style={styles.iconWrap}>
          <UserRoundCheck
            size={30}
            color={colors.textPrimary}
            strokeWidth={1.8}
          />
        </View>

        <Text style={styles.title}>Pick a username</Text>
        <Text style={styles.subtitle}>
          You&apos;re signed in! Choose how you&apos;ll show up in the community.
          You can change this later.
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
          returnKeyType="done"
          onSubmitEditing={handleCreate}
          error={errors.username}
          helperText={
            !errors.username
              ? "Lowercase, 3–20 chars. Letters, numbers, underscore."
              : undefined
          }
          editable={!submitting}
        />

        <Button
          label="Create account"
          onPress={handleCreate}
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
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
    iconWrap: {
      width: 72,
      height: 72,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
    },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.title,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      lineHeight: 34,
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
  });
}
