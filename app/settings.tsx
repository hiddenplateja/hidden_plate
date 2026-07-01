// app/settings.tsx
// User settings screen.
//
// Sections:
//   Account: email (read-only), change password (inline form)
//   Notifications: server-backed toggles (account.prefs)
//                  - Master switch + per-type toggles for likes, comments,
//                    follows, broadcasts. The send-notification function
//                    reads these prefs and short-circuits before sending.
//   Privacy: blocked users management
//   About: privacy/terms links, app version
//   Account management: delete-account request (email-based for now)
//
// Reached from the side menu in the profile tab.

import { useAuth } from "@/hooks/useAuth";
import { deleteMyAccount } from "@/services/accountDeletion";
import { changePassword } from "@/services/auth";
import { bugReportsEnabled } from "@/services/bugReports";
import {
  DEFAULT_PREFERENCES,
  getUserPreferences,
  updateUserPreferences,
  type UserPreferences,
} from "@/services/userPreferences";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  // ── Notification preferences ──────────────────────────────────────────
  // Loaded from account.prefs on mount; toggles persist back via
  // updateUserPreferences. Sub-toggles dim out when the master is off.
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [prefsLoading, setPrefsLoading] = useState(true);
  // Per-key in-flight set so individual switches can show their own busy
  // state without freezing the whole screen.
  const [savingKeys, setSavingKeys] = useState<Set<keyof UserPreferences>>(
    new Set(),
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      const next = await getUserPreferences();
      if (mounted) {
        setPrefs(next);
        setPrefsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const togglePref = useCallback(
    async (key: keyof UserPreferences, nextValue: boolean) => {
      const prior = prefs[key];
      // Optimistic — switch flips instantly, reverts on failure.
      setPrefs((p) => ({ ...p, [key]: nextValue }));
      setSavingKeys((p) => {
        const s = new Set(p);
        s.add(key);
        return s;
      });
      try {
        await updateUserPreferences({ [key]: nextValue });
      } catch {
        setPrefs((p) => ({ ...p, [key]: prior }));
        Alert.alert("Couldn't save", "Check your connection and try again.");
      } finally {
        setSavingKeys((p) => {
          const s = new Set(p);
          s.delete(key);
          return s;
        });
      }
    },
    [prefs],
  );

  // ── Change-password form ──────────────────────────────────────────────
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  // Account deletion — two-stage confirmation. The user must type their
  // exact email to enable the final Delete button. This is intentional
  // friction; account deletion is irreversible.
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleChangePassword = useCallback(async () => {
    setPasswordError(null);

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

  // Final delete — only reachable after the user has typed-to-confirm.
  // We don't show a second Alert because the inline typed confirmation
  // IS the confirmation step.
  const handleConfirmDelete = useCallback(async () => {
    if (!user) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteMyAccount();
      // The auth account is gone server-side, but AuthContext still holds
      // the now-stale user. Call logout() to clear that state — it will
      // try to delete the session server-side too, but we swallow the
      // error since the session is already invalid (because the account
      // doesn't exist anymore).
      //
      // After this runs, AuthContext.user = null, AuthContext.isAuthenticated
      // = false, and your root layout's auth gate kicks the user back to
      // the sign-in screen automatically.
      try {
        await logout();
      } catch {
        // Session-already-invalid is expected here. Ignore.
      }
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Couldn't delete your account. Please try again.",
      );
      setDeleting(false);
    }
  }, [user, logout]);
  const appVersion =
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    "1.0.0";
  const buildVersion =
    Application.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    "1";

  // Sub-toggles dim out when the master is off — they're still toggleable
  // but visually de-emphasized so it's clear the master overrides them.
  const masterDisabled = !prefs.notificationsEnabled;

  return (
    <View style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
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

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
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
            {prefsLoading ? (
              <View style={styles.loadingBlock}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <>
                <ToggleRow
                  icon="bell-outline"
                  label="Enable notifications"
                  hint="Master switch for all push notifications"
                  value={prefs.notificationsEnabled}
                  onChange={(v) => togglePref("notificationsEnabled", v)}
                  disabled={savingKeys.has("notificationsEnabled")}
                />
                <Divider />
                <ToggleRow
                  icon="heart-outline"
                  label="Likes"
                  hint="When someone likes your review"
                  value={prefs.notifyOnLike}
                  onChange={(v) => togglePref("notifyOnLike", v)}
                  disabled={masterDisabled || savingKeys.has("notifyOnLike")}
                />
                <Divider />
                <ToggleRow
                  icon="comment-outline"
                  label="Comments"
                  hint="When someone comments on your review"
                  value={prefs.notifyOnComment}
                  onChange={(v) => togglePref("notifyOnComment", v)}
                  disabled={masterDisabled || savingKeys.has("notifyOnComment")}
                />
                <Divider />
                <ToggleRow
                  icon="account-multiple-outline"
                  label="New followers"
                  hint="When someone follows you"
                  value={prefs.notifyOnFollow}
                  onChange={(v) => togglePref("notifyOnFollow", v)}
                  disabled={masterDisabled || savingKeys.has("notifyOnFollow")}
                />
                <Divider />
                <ToggleRow
                  icon="bullhorn-outline"
                  label="Announcements"
                  hint="New restaurants and app news"
                  value={prefs.notifyOnBroadcast}
                  onChange={(v) => togglePref("notifyOnBroadcast", v)}
                  disabled={
                    masterDisabled || savingKeys.has("notifyOnBroadcast")
                  }
                />
              </>
            )}
          </View>

          {/* ── Privacy section ── */}
          <SectionTitle text="Privacy" />
          <View style={styles.sectionCard}>
            <Pressable
              style={styles.actionRow}
              onPress={() => router.push("/blocked-users")}
              accessibilityRole="button"
            >
              <View style={styles.actionIcon}>
                <MaterialCommunityIcons
                  name="account-cancel-outline"
                  size={20}
                  color={colors.textPrimary}
                />
              </View>
              <Text style={styles.actionLabel}>Blocked users</Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          {/* ── Support section ── */}
          {bugReportsEnabled() ? (
            <>
              <SectionTitle text="Support" />
              <View style={styles.sectionCard}>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => router.push("/report-bug")}
                  accessibilityRole="button"
                >
                  <View style={styles.actionIcon}>
                    <MaterialCommunityIcons
                      name="bug-outline"
                      size={20}
                      color={colors.textPrimary}
                    />
                  </View>
                  <Text style={styles.actionLabel}>Report a bug</Text>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
            </>
          ) : null}

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
            {!showDeleteForm ? (
              <Pressable
                style={styles.actionRow}
                onPress={() => setShowDeleteForm(true)}
              >
                <View style={[styles.actionIcon, styles.actionIconDanger]}>
                  <MaterialCommunityIcons
                    name="account-remove-outline"
                    size={20}
                    color={colors.error}
                  />
                </View>
                <Text style={[styles.actionLabel, styles.actionLabelDanger]}>
                  Delete account
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.error}
                />
              </Pressable>
            ) : (
              <View style={styles.passwordForm}>
                <Text style={styles.deleteHeading}>Delete your account</Text>
                <Text style={styles.deleteBody}>
                  This will permanently delete your account, likes, saved spots,
                  follows, and notifications.
                </Text>
                <Text style={styles.deleteBody}>
                  Your reviews and comments will stay visible but appear as
                  &quot;Deleted user&quot; so restaurant ratings aren&apos;t
                  affected.
                </Text>
                <Text style={[styles.deleteBody, styles.deleteWarn]}>
                  This action can&apos;t be undone.
                </Text>

                <Text style={styles.formLabel}>
                  To confirm, type your email below
                </Text>
                <TextInput
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  style={styles.input}
                  placeholder={user?.email ?? ""}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!deleting}
                />

                {deleteError ? (
                  <Text style={styles.errorText}>{deleteError}</Text>
                ) : null}

                <View style={styles.formButtons}>
                  <Pressable
                    onPress={() => {
                      setShowDeleteForm(false);
                      setDeleteConfirmText("");
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    onPress={handleConfirmDelete}
                    disabled={
                      deleting ||
                      deleteConfirmText.trim().toLowerCase() !==
                        (user?.email ?? "").trim().toLowerCase()
                    }
                    style={({ pressed }) => [
                      styles.dangerBtn,
                      pressed && styles.pressed,
                      (deleting ||
                        deleteConfirmText.trim().toLowerCase() !==
                          (user?.email ?? "").trim().toLowerCase()) &&
                        styles.dangerBtnDisabled,
                    ]}
                  >
                    {deleting ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.textInverse}
                      />
                    ) : (
                      <Text style={styles.dangerBtnText}>Delete account</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

// ---------- Sub-components ----------

function SectionTitle({ text }: { text: string }) {
  const { styles } = useThemedStyles(makeStyles);
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
  const { styles, colors } = useThemedStyles(makeStyles);
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
  disabled,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}>
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
        disabled={disabled}
        trackColor={{ false: colors.divider, true: colors.primary }}
        thumbColor={colors.cardBackground}
        ios_backgroundColor={colors.divider}
      />
    </View>
  );
}

function Divider() {
  const { styles } = useThemedStyles(makeStyles);
  return <View style={styles.divider} />;
}

// ---------- Styles ----------

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.cardBackground },
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
  // On the all-white surface we drop the card border/radius — rows sit
  // flat, separated only by hairline dividers within and section titles
  // between. Cleaner read on a single-surface layout.
  sectionCard: {
    backgroundColor: colors.cardBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
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
  toggleRowDisabled: { opacity: 0.45 },
  toggleText: { flex: 1 },
  toggleHint: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  loadingBlock: {
    paddingVertical: spacing.xl,
    alignItems: "center",
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
  // Delete-account form: stark red CTA, disabled until the user types
  // their email to confirm.
  dangerBtn: {
    flex: 1,
    backgroundColor: colors.error,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnDisabled: {
    opacity: 0.4,
  },
  dangerBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  deleteHeading: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.error,
    marginBottom: spacing.sm,
  },
  deleteBody: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  deleteWarn: {
    fontFamily: fonts.bold,
    color: colors.error,
  },
  // Visible, obviously-a-button styling so you can tell the test fires.
  // Remove this style along with the test button once Sentry is verified.
  testBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  testBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },

  pressed: { opacity: 0.7 },
  });
}
