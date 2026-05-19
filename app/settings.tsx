// app/settings.tsx
// User settings screen.
//
// Sections:
//   - Account: change password
//   - Notifications: toggle stubs (we don't have push notifications yet,
//     but the toggles are here for future use — they save to local state
//     only for now)
//   - About: app version, links to Privacy and Terms
//
// Delete account is deliberately omitted from this version — handling it
// properly requires backend cleanup that's out of scope right now. Users
// can email support to request account deletion.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { changePassword } from "@/services/auth";
import {
    colors,
    fonts,
    radius,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  // Notification toggles — local-only stubs. When push notifications ship,
  // these will sync to the backend / device push token registration.
  const [notifLikes, setNotifLikes] = useState(true);
  const [notifFollows, setNotifFollows] = useState(true);
  const [notifWeekly, setNotifWeekly] = useState(false);

  // Change-password form state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const appVersion =
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    "1.0.0";
  const buildVersion =
    Application.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    "1";

  const handleChangePassword = useCallback(async () => {
    setPasswordError(null);

    // Validate
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError("All fields are required.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }
    if (newPassword === oldPassword) {
      setPasswordError("New password must be different from your current one.");
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(oldPassword, newPassword);
      // Reset form on success
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
      Alert.alert(
        "Password changed",
        "Your password has been updated successfully.",
      );
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Couldn't change password.",
      );
    } finally {
      setChangingPassword(false);
    }
  }, [oldPassword, newPassword, confirmPassword]);

  const handleDeleteAccountRequest = useCallback(() => {
    Alert.alert(
      "Delete account",
      "Account deletion is currently handled manually. Email " +
        "support@hiddenplateja.com from your account email and we'll " +
        "process your request within 30 days.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Email support",
          onPress: () => {
            const subject = "Account deletion request";
            const body = `Account: ${user?.email ?? "(unknown)"}\n\nPlease delete my account.`;
            const url = `mailto:support@hiddenplateja.com?subject=${encodeURIComponent(
              subject,
            )}&body=${encodeURIComponent(body)}`;
            Linking.openURL(url).catch(() => {
              Alert.alert(
                "Couldn't open email",
                "Please contact support@hiddenplateja.com manually.",
              );
            });
          },
        },
      ],
    );
  }, [user]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Account section ── */}
          <SectionTitle text="Account" />
          <View style={styles.sectionCard}>
            <Row
              icon="email-outline"
              label="Email"
              value={user?.email ?? "—"}
            />
            <Divider />
            {!showPasswordForm ? (
              <Pressable
                style={styles.actionRow}
                onPress={() => setShowPasswordForm(true)}
                accessibilityRole="button"
              >
                <View style={styles.actionIcon}>
                  <MaterialCommunityIcons
                    name="lock-outline"
                    size={20}
                    color={colors.textPrimary}
                  />
                </View>
                <Text style={styles.actionLabel}>Change password</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>
            ) : (
              <View style={styles.passwordForm}>
                <Text style={styles.formLabel}>Current password</Text>
                <TextInput
                  value={oldPassword}
                  onChangeText={setOldPassword}
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!changingPassword}
                />

                <Text style={styles.formLabel}>New password</Text>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  style={styles.input}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!changingPassword}
                />

                <Text style={styles.formLabel}>Confirm new password</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  style={styles.input}
                  placeholder="Repeat new password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!changingPassword}
                />

                {passwordError ? (
                  <Text style={styles.errorText}>{passwordError}</Text>
                ) : null}

                <View style={styles.formButtons}>
                  <Pressable
                    onPress={() => {
                      setShowPasswordForm(false);
                      setOldPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setPasswordError(null);
                    }}
                    disabled={changingPassword}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    onPress={handleChangePassword}
                    disabled={changingPassword}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    {changingPassword ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.textInverse}
                      />
                    ) : (
                      <Text style={styles.primaryBtnText}>Update password</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          {/* ── Notifications section ── */}
          <SectionTitle text="Notifications" />
          <View style={styles.sectionCard}>
            <ToggleRow
              icon="heart-outline"
              label="Likes on my reviews"
              hint="Notify me when someone likes my review"
              value={notifLikes}
              onChange={setNotifLikes}
            />
            <Divider />
            <ToggleRow
              icon="account-multiple-outline"
              label="New followers"
              hint="Notify me when someone follows me"
              value={notifFollows}
              onChange={setNotifFollows}
            />
            <Divider />
            <ToggleRow
              icon="email-newsletter"
              label="Weekly digest"
              hint="A weekly summary of top spots and your activity"
              value={notifWeekly}
              onChange={setNotifWeekly}
            />
          </View>
          <Text style={styles.notifNote}>
            Push notifications are coming soon. Your preferences will be saved
            for when they launch.
          </Text>

          {/* ── About section ── */}
          <SectionTitle text="About" />
          <View style={styles.sectionCard}>
            <Pressable
              style={styles.actionRow}
              onPress={() => router.push("/privacy")}
            >
              <View style={styles.actionIcon}>
                <MaterialCommunityIcons
                  name="shield-check-outline"
                  size={20}
                  color={colors.textPrimary}
                />
              </View>
              <Text style={styles.actionLabel}>Privacy Policy</Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
            <Divider />
            <Pressable
              style={styles.actionRow}
              onPress={() => router.push("/terms")}
            >
              <View style={styles.actionIcon}>
                <MaterialCommunityIcons
                  name="file-document-outline"
                  size={20}
                  color={colors.textPrimary}
                />
              </View>
              <Text style={styles.actionLabel}>Terms of Service</Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
            <Divider />
            <Row
              icon="information-outline"
              label="App version"
              value={`${appVersion} (${buildVersion})`}
            />
          </View>

          {/* ── Danger zone ── */}
          <SectionTitle text="Account management" />
          <View style={styles.sectionCard}>
            <Pressable
              style={styles.actionRow}
              onPress={handleDeleteAccountRequest}
            >
              <View style={[styles.actionIcon, styles.actionIconDanger]}>
                <MaterialCommunityIcons
                  name="account-remove-outline"
                  size={20}
                  color={colors.error}
                />
              </View>
              <Text style={[styles.actionLabel, styles.actionLabelDanger]}>
                Request account deletion
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.error}
              />
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

// ---------- Sub-components ----------

function SectionTitle({ text }: { text: string }) {
  return <Text style={styles.sectionTitle}>{text}</Text>;
}

function Row({
  icon,
  label,
  value,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.actionIcon}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={colors.textPrimary}
        />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.actionIcon}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={colors.textPrimary}
        />
      </View>
      <View style={styles.toggleText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.divider, true: colors.primary }}
        thumbColor={colors.cardBackground}
      />
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.huge,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  sectionCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconDanger: {
    backgroundColor: colors.errorBg,
  },
  actionLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  actionLabelDanger: {
    color: colors.error,
    fontFamily: fonts.bold,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  rowValue: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    maxWidth: 200,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  toggleText: { flex: 1 },
  toggleHint: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  passwordForm: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  formLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  input: {
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.error,
    marginTop: spacing.xs,
  },
  formButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.divider,
  },
  secondaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.7 },
  notifNote: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginHorizontal: spacing.xs,
    fontStyle: "italic",
    lineHeight: 16,
  },
});
