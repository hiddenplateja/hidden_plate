// app/edit-profile.tsx
// Edit profile screen — change avatar, display name, and bio.
//
// Reached from the pencil icon on your own profile avatar.
//
// Behavior:
//   - Loads current profile data on mount
//   - Avatar: tap pencil to pick a new one (preview shown immediately)
//   - Display name: 2-50 chars, required
//   - Bio: 0-280 chars, optional, with live character counter
//   - Save: validates, compresses + uploads new avatar if changed,
//     deletes old avatar after successful upload, updates profile doc
//   - Cancel: warns if there are unsaved changes
//
// Photo flow:
//   pick → compress (600px wide, 0.75 quality) → upload → save profile doc
//   → delete old avatar (best-effort, ignored if it fails)

import { Camera, Lock } from "lucide-react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/hooks/useAuth";
import { compressAvatar, deleteImage, uploadAvatar } from "@/services/storage";
import {
    getUserPreferences,
    updateUserPreferences,
} from "@/services/userPreferences";
import {
    getUserById,
    updateMyProfile,
    validateBio,
    validateDisplayName,
    validateUsername,
} from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { User } from "@/types/user";

const BIO_MAX = 280;

// Per-field change cooldowns. Stored as last-changed timestamps in account
// prefs; the field locks until the cooldown elapses. (Soft, client-side limit —
// the profile doc is written directly by the SDK.)
const DAY_MS = 24 * 60 * 60 * 1000;
const USERNAME_COOLDOWN_DAYS = 30;
const DISPLAY_NAME_COOLDOWN_DAYS = 7;

// Whole days remaining until `ts` (epoch ms), floored at 1 so we never say "0".
function daysUntil(ts: number): number {
  return Math.max(1, Math.ceil((ts - Date.now()) / DAY_MS));
}

// Avatar field state — three cases handled cleanly via discriminated union.
type AvatarState =
  | { kind: "unchanged"; fileId: string | null }
  | { kind: "replaced"; localUri: string; oldFileId: string | null }
  | { kind: "cleared"; oldFileId: string | null };

export default function EditProfileScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  // Last-changed timestamps (from prefs) → drive the per-field cooldown locks.
  const [usernameChangedAt, setUsernameChangedAt] = useState<string | null>(
    null,
  );
  const [displayNameChangedAt, setDisplayNameChangedAt] = useState<
    string | null
  >(null);
  const [avatarState, setAvatarState] = useState<AvatarState>({
    kind: "unchanged",
    fileId: null,
  });

  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);

  // Cooldown gates — a field is locked until (lastChange + cooldown). A null
  // timestamp (never changed) leaves it unlocked.
  const now = Date.now();
  const usernameUnlockAt = usernameChangedAt
    ? new Date(usernameChangedAt).getTime() + USERNAME_COOLDOWN_DAYS * DAY_MS
    : 0;
  const displayNameUnlockAt = displayNameChangedAt
    ? new Date(displayNameChangedAt).getTime() +
      DISPLAY_NAME_COOLDOWN_DAYS * DAY_MS
    : 0;
  const usernameLocked = now < usernameUnlockAt;
  const displayNameLocked = now < displayNameUnlockAt;

  // Load current profile data
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await getUserById(user.id);
        if (cancelled) return;
        if (!fresh) {
          Alert.alert("Couldn't load profile", "Please try again.");
          router.back();
          return;
        }
        setProfile(fresh);
        setUsername(fresh.username);
        setDisplayName(fresh.displayName);
        setBio(fresh.bio ?? "");
        setAvatarState({
          kind: "unchanged",
          fileId: fresh.avatarUrl ?? null,
        });
        // Cooldown timestamps live in account prefs (no schema change).
        const prefs = await getUserPreferences();
        if (cancelled) return;
        setUsernameChangedAt(prefs.usernameChangedAt);
        setDisplayNameChangedAt(prefs.displayNameChangedAt);
      } catch (err) {
        Alert.alert(
          "Couldn't load profile",
          err instanceof Error ? err.message : "Try again.",
        );
        router.back();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  const hasChanges = useCallback((): boolean => {
    if (!profile) return false;
    if (username.trim().toLowerCase() !== profile.username) return true;
    if (displayName.trim() !== profile.displayName) return true;
    if ((bio.trim() || null) !== (profile.bio ?? null)) return true;
    if (avatarState.kind !== "unchanged") return true;
    return false;
  }, [profile, username, displayName, bio, avatarState]);

  const handleCancel = useCallback(() => {
    if (!hasChanges()) {
      router.back();
      return;
    }
    Alert.alert("Discard changes?", "You have unsaved changes. Leave anyway?", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => router.back(),
      },
    ]);
  }, [hasChanges, router]);

  const handlePickAvatar = useCallback(async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Hidden Plate needs access to your photos to set an avatar.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setAvatarState((prev) => ({
        kind: "replaced",
        localUri: asset.uri,
        oldFileId:
          prev.kind === "unchanged"
            ? prev.fileId
            : prev.kind === "replaced"
              ? prev.oldFileId
              : prev.oldFileId,
      }));
    } catch (err) {
      Alert.alert(
        "Couldn't pick image",
        err instanceof Error ? err.message : "Try again.",
      );
    }
  }, []);

  const handleClearAvatar = useCallback(() => {
    Alert.alert(
      "Remove avatar?",
      "Your profile will show the default colored circle.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setAvatarState((prev) => ({
              kind: "cleared",
              oldFileId:
                prev.kind === "unchanged"
                  ? prev.fileId
                  : prev.kind === "replaced"
                    ? prev.oldFileId
                    : prev.oldFileId,
            }));
          },
        },
      ],
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!profile) return;

    const trimmedName = displayName.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const nameChanged = trimmedName !== profile.displayName;
    const usernameChanged = trimmedUsername !== profile.username;

    // Defensive cooldown enforcement — the inputs are disabled while locked, so
    // this only trips if a locked field somehow changed.
    if (usernameChanged && usernameLocked) {
      setUsernameError(
        `You can change your username again in ${daysUntil(usernameUnlockAt)} days.`,
      );
      return;
    }
    if (nameChanged && displayNameLocked) {
      setDisplayNameError(
        `You can change your display name again in ${daysUntil(displayNameUnlockAt)} days.`,
      );
      return;
    }

    // Validate only the fields that actually changed.
    const usernameErr = usernameChanged ? validateUsername(username) : null;
    const nameErr = nameChanged ? validateDisplayName(displayName) : null;
    const bioErr = validateBio(bio);
    setUsernameError(usernameErr);
    setDisplayNameError(nameErr);
    setBioError(bioErr);
    if (usernameErr || nameErr || bioErr) return;

    if (!hasChanges()) {
      router.back();
      return;
    }

    setSaving(true);
    try {
      // Resolve the final avatarUrl field value
      let newAvatarFileId: string | null | undefined = undefined;
      let fileIdToDelete: string | null = null;

      if (avatarState.kind === "replaced") {
        const compressed = await compressAvatar(avatarState.localUri);
        newAvatarFileId = await uploadAvatar(compressed);
        fileIdToDelete = avatarState.oldFileId;
      } else if (avatarState.kind === "cleared") {
        newAvatarFileId = null;
        fileIdToDelete = avatarState.oldFileId;
      }
      // unchanged: leave newAvatarFileId as undefined — won't be in update payload

      // Update the profile doc — only send the name fields that changed (so a
      // locked-but-untouched field is never written).
      await updateMyProfile({
        ...(usernameChanged ? { username: trimmedUsername } : {}),
        ...(nameChanged ? { displayName: trimmedName } : {}),
        bio: bio.trim() || null,
        ...(newAvatarFileId !== undefined
          ? { avatarUrl: newAvatarFileId }
          : {}),
      });

      // Record the change timestamps (starts the cooldown). Best-effort: the
      // profile already saved, so a prefs hiccup just means the soft limit
      // didn't start — not worth failing the save.
      if (usernameChanged || nameChanged) {
        const nowIso = new Date().toISOString();
        try {
          await updateUserPreferences({
            ...(usernameChanged ? { usernameChangedAt: nowIso } : {}),
            ...(nameChanged ? { displayNameChangedAt: nowIso } : {}),
          });
        } catch {
          // soft limit — ignore
        }
      }

      // Best-effort: delete the old avatar file after the update succeeded.
      // If this fails, leave an orphan — better than failing the save.
      if (fileIdToDelete) {
        deleteImage(fileIdToDelete).catch(() => {
          // Swallow — orphan cleanup is non-critical
        });
      }

      // Propagate the new username/display name to the rest of the app.
      try {
        await refresh();
      } catch {
        // non-fatal — other screens refetch on focus
      }

      router.back();
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    profile,
    username,
    displayName,
    bio,
    avatarState,
    hasChanges,
    router,
    refresh,
    usernameLocked,
    displayNameLocked,
    usernameUnlockAt,
    displayNameUnlockAt,
  ]);

  if (loading || !user || !profile) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={["top"]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // Decide what to render for the avatar preview
  const avatarPreview: AvatarPreviewKind = (() => {
    if (avatarState.kind === "replaced") {
      return { type: "local", uri: avatarState.localUri };
    }
    if (avatarState.kind === "cleared") {
      return { type: "fallback" };
    }
    return { type: "stored", fileId: avatarState.fileId };
  })();

  const bioRemaining = BIO_MAX - bio.length;
  const bioWarning = bioRemaining < 20;

  return (
    <View style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={handleCancel}
            disabled={saving}
            hitSlop={10}
            style={styles.headerBtn}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            hitSlop={10}
            style={styles.headerBtn}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text
                style={[styles.saveText, !hasChanges() && styles.saveDisabled]}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          {/* Avatar section */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrap}>
              {avatarPreview.type === "local" ? (
                <Image
                  source={{ uri: avatarPreview.uri }}
                  style={styles.localAvatar}
                  contentFit="cover"
                />
              ) : avatarPreview.type === "fallback" ? (
                <Avatar
                  fileId={null}
                  displayName={profile.displayName}
                  userId={profile.id}
                  size={120}
                />
              ) : (
                <Avatar
                  fileId={avatarPreview.fileId}
                  displayName={profile.displayName}
                  userId={profile.id}
                  size={120}
                />
              )}
              <Pressable
                style={styles.avatarEditBadge}
                onPress={handlePickAvatar}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Change avatar"
              >
                <Camera size={17} color={colors.onPrimary} strokeWidth={2} />
              </Pressable>
            </View>

            <View style={styles.avatarActions}>
              <Pressable onPress={handlePickAvatar} hitSlop={6}>
                <Text style={styles.avatarActionText}>
                  {avatarPreview.type === "fallback"
                    ? "Add photo"
                    : "Change photo"}
                </Text>
              </Pressable>
              {avatarPreview.type !== "fallback" ? (
                <>
                  <Text style={styles.avatarActionSep}>·</Text>
                  <Pressable onPress={handleClearAvatar} hitSlop={6}>
                    <Text
                      style={[
                        styles.avatarActionText,
                        styles.avatarActionDanger,
                      ]}
                    >
                      Remove
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>

          {/* Username — editable once every 30 days */}
          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            {usernameLocked ? (
              <>
                <View style={styles.readOnlyInput}>
                  <Text style={styles.readOnlyText}>@{profile.username}</Text>
                  <Lock size={15} color={colors.textMuted} strokeWidth={2} />
                </View>
                <Text style={styles.hint}>
                  You can change your username again in{" "}
                  {daysUntil(usernameUnlockAt)} days.
                </Text>
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.inputRow,
                    usernameError ? styles.inputError : null,
                  ]}
                >
                  <Text style={styles.inputPrefix}>@</Text>
                  <TextInput
                    value={username}
                    onChangeText={(t) => {
                      setUsername(t.toLowerCase().replace(/\s/g, ""));
                      if (usernameError) setUsernameError(null);
                    }}
                    style={styles.inputFlex}
                    placeholder="username"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    editable={!saving}
                  />
                </View>
                {usernameError ? (
                  <Text style={styles.errorText}>{usernameError}</Text>
                ) : (
                  <Text style={styles.hint}>
                    Lowercase letters, numbers, underscore. Changeable once every
                    30 days.
                  </Text>
                )}
              </>
            )}
          </View>

          {/* Display name — editable once every 7 days */}
          <View style={styles.field}>
            <Text style={styles.label}>Display name</Text>
            {displayNameLocked ? (
              <>
                <View style={styles.readOnlyInput}>
                  <Text style={styles.readOnlyText}>{profile.displayName}</Text>
                  <Lock size={15} color={colors.textMuted} strokeWidth={2} />
                </View>
                <Text style={styles.hint}>
                  You can change your display name again in{" "}
                  {daysUntil(displayNameUnlockAt)} days.
                </Text>
              </>
            ) : (
              <>
                <TextInput
                  value={displayName}
                  onChangeText={(t) => {
                    setDisplayName(t);
                    if (displayNameError) setDisplayNameError(null);
                  }}
                  style={[
                    styles.input,
                    displayNameError ? styles.inputError : null,
                  ]}
                  placeholder="Your name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={50}
                  editable={!saving}
                />
                {displayNameError ? (
                  <Text style={styles.errorText}>{displayNameError}</Text>
                ) : (
                  <Text style={styles.hint}>Changeable once every 7 days.</Text>
                )}
              </>
            )}
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Bio</Text>
              <Text
                style={[
                  styles.charCount,
                  bioWarning && styles.charCountWarning,
                ]}
              >
                {bioRemaining}
              </Text>
            </View>
            <TextInput
              value={bio}
              onChangeText={(t) => {
                setBio(t);
                if (bioError) setBioError(null);
              }}
              style={[
                styles.input,
                styles.bioInput,
                bioError ? styles.inputError : null,
              ]}
              placeholder="Tell others about yourself…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={BIO_MAX}
              textAlignVertical="top"
              editable={!saving}
            />
            {bioError ? (
              <Text style={styles.errorText}>{bioError}</Text>
            ) : (
              <Text style={styles.hint}>Optional. Shown on your profile.</Text>
            )}
          </View>

          {/* Read-only email — from the auth user (Account), not the profile
              doc; the doc carries no email since it's readable by all users. */}
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.readOnlyInput}>
              <Text style={styles.readOnlyText}>{user?.email || "—"}</Text>
              <Lock size={15} color={colors.textMuted} strokeWidth={2} />
            </View>
            <Text style={styles.hint}>
              To change your email, contact support.
            </Text>
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

type AvatarPreviewKind =
  | { type: "local"; uri: string }
  | { type: "fallback" }
  | { type: "stored"; fileId: string | null };

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
  },
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
  headerBtn: {
    minWidth: 60,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  cancelText: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  saveText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.primary,
    textAlign: "right",
  },
  saveDisabled: {
    color: colors.textMuted,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  avatarSection: {
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    paddingVertical: spacing.xl,
    marginBottom: spacing.sm,
  },
  avatarWrap: {
    position: "relative",
    marginBottom: spacing.md,
  },
  localAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.pageBackground,
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.cardBackground,
  },
  avatarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  avatarActionText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  avatarActionDanger: {
    color: colors.error,
  },
  avatarActionSep: {
    color: colors.textMuted,
  },
  field: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    marginBottom: spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
    marginBottom: spacing.xs,
  },
  charCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  charCountWarning: {
    color: colors.warning,
    fontFamily: fonts.bold,
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
  inputError: {
    borderColor: colors.error,
  },
  // Username row: an "@" prefix sitting inside the same box as the input.
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  inputPrefix: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
  },
  inputFlex: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
    marginLeft: 2,
  },
  bioInput: {
    minHeight: 100,
    paddingTop: spacing.md,
  },
  readOnlyInput: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  readOnlyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.error,
    marginTop: spacing.xs,
  },
  });
}
