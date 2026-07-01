// app/onboarding.tsx
// One-time, skippable new-user onboarding (3 steps), shown right after signup
// via the root gate (AuthContext.needsOnboarding). Seeds personalization:
//   1. Taste    — pick favorite cuisines + parishes (→ For You ranking signals)
//   2. Follow   — follow suggested users (→ seeds the Following feed)
//   3. Get set  — enable location + push
// Finishing/skipping saves favorites + clears the pending flag, then refresh()
// lets the gate fall through into the app.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StepDots } from "@/components/auth/StepDots";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/Button";
import { CUISINE_OPTIONS, PARISH_OPTIONS } from "@/constants/restaurantOptions";
import { useAuth } from "@/hooks/useAuth";
import {
  followUser,
  getFollowingSetForUsers,
  unfollowUser,
} from "@/services/follows";
import { registerForPushNotifications } from "@/services/pushTokens";
import { completeOnboarding } from "@/services/userPreferences";
import { getSuggestedUsers } from "@/services/users";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Parish } from "@/types/restaurant";
import type { User } from "@/types/user";

export default function OnboardingScreen() {
  const { user, refresh } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);

  // Step 1 — taste
  const [cuisines, setCuisines] = useState<Set<string>>(new Set());
  const [parishes, setParishes] = useState<Set<Parish>>(new Set());

  // Step 2 — suggested users
  const [suggested, setSuggested] = useState<User[] | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [followBusy, setFollowBusy] = useState<string | null>(null);

  // Step 3 — permissions
  const [locationOn, setLocationOn] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  // Load suggestions up-front so they're ready by step 2.
  useEffect(() => {
    let active = true;
    getSuggestedUsers(10)
      .then(async (users) => {
        if (!active) return;
        setSuggested(users);
        const set = await getFollowingSetForUsers(users.map((u) => u.id));
        if (active) setFollowed(set);
      })
      .catch(() => active && setSuggested([]));
    return () => {
      active = false;
    };
  }, []);

  const toggleCuisine = useCallback((c: string) => {
    setCuisines((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  const toggleParish = useCallback((p: Parish) => {
    setParishes((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const toggleFollow = useCallback(
    async (u: User) => {
      if (followBusy) return;
      const isFollowing = followed.has(u.id);
      setFollowBusy(u.id);
      setFollowed((prev) => {
        const next = new Set(prev);
        if (isFollowing) next.delete(u.id);
        else next.add(u.id);
        return next;
      });
      try {
        if (isFollowing) await unfollowUser(u.id);
        else await followUser(u.id);
      } catch {
        // revert
        setFollowed((prev) => {
          const next = new Set(prev);
          if (isFollowing) next.add(u.id);
          else next.delete(u.id);
          return next;
        });
      } finally {
        setFollowBusy(null);
      }
    },
    [followBusy, followed],
  );

  const enableLocation = useCallback(async () => {
    if (locBusy || locationOn) return;
    setLocBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationOn(status === "granted");
    } catch {
      // ignore — user can enable later from Settings
    } finally {
      setLocBusy(false);
    }
  }, [locBusy, locationOn]);

  const enablePush = useCallback(async () => {
    if (pushBusy || pushOn || !user) return;
    setPushBusy(true);
    try {
      const token = await registerForPushNotifications(user.id);
      setPushOn(!!token);
      if (!token) {
        Alert.alert(
          "Couldn't enable notifications",
          "You can turn them on later in Settings.",
        );
      }
    } catch {
      // ignore
    } finally {
      setPushBusy(false);
    }
  }, [pushBusy, pushOn, user]);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await completeOnboarding({
        favoriteCuisines: [...cuisines],
        favoriteParishes: [...parishes],
      });
      // Reloads needsOnboarding → false; the root gate routes into the app.
      await refresh();
    } catch {
      Alert.alert("Something went wrong", "Please try again.");
      setFinishing(false);
    }
  }, [finishing, cuisines, parishes, refresh]);

  const isLast = step === 2;
  const next = useCallback(() => {
    if (isLast) finish();
    else setStep((s) => s + 1);
  }, [isLast, finish]);

  // "Skip" advances ONE step at a time (skips just the current step), not the
  // whole flow — only the last step's skip actually finishes onboarding.
  const skipStep = useCallback(() => {
    if (isLast) finish();
    else setStep((s) => s + 1);
  }, [isLast, finish]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        {step > 0 ? (
          <Pressable
            onPress={() => setStep((s) => s - 1)}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={colors.textPrimary}
            />
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}
        <StepDots total={3} index={step} />
        <Pressable
          onPress={skipStep}
          hitSlop={10}
          style={styles.skipBtn}
          disabled={finishing}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? (
          <>
            <Text style={styles.title}>What do you love to eat?</Text>
            <Text style={styles.subtitle}>
              Pick a few — we&apos;ll tune your For You feed around them.
            </Text>

            <Text style={styles.groupLabel}>Cuisines</Text>
            <View style={styles.chipWrap}>
              {CUISINE_OPTIONS.map((c) => {
                const active = cuisines.has(c);
                return (
                  <Pressable
                    key={c}
                    onPress={() => toggleCuisine(c)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {c}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.groupLabel}>Parishes</Text>
            <View style={styles.chipWrap}>
              {PARISH_OPTIONS.map((p) => {
                const active = parishes.has(p.value);
                return (
                  <Pressable
                    key={p.value}
                    onPress={() => toggleParish(p.value)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : step === 1 ? (
          <>
            <Text style={styles.title}>Follow some foodies</Text>
            <Text style={styles.subtitle}>
              Their reviews fill up your Following feed.
            </Text>

            {suggested === null ? (
              <View style={styles.loader}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : suggested.length === 0 ? (
              <Text style={styles.emptyText}>
                No suggestions yet — you can find people from any profile later.
              </Text>
            ) : (
              suggested.map((u) => {
                const isFollowing = followed.has(u.id);
                return (
                  <View key={u.id} style={styles.userRow}>
                    <Avatar
                      fileId={u.avatarUrl}
                      displayName={u.displayName}
                      userId={u.id}
                      size={44}
                    />
                    <View style={styles.userText}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {u.displayName}
                      </Text>
                      <Text style={styles.userHandle} numberOfLines={1}>
                        @{u.username}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => toggleFollow(u)}
                      disabled={followBusy === u.id}
                      style={[
                        styles.followBtn,
                        isFollowing && styles.followingBtn,
                      ]}
                      accessibilityRole="button"
                    >
                      {followBusy === u.id ? (
                        <ActivityIndicator
                          size="small"
                          color={isFollowing ? colors.primary : colors.textInverse}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.followText,
                            isFollowing && styles.followingText,
                          ]}
                        >
                          {isFollowing ? "Following" : "Follow"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>Get the most out of it</Text>
            <Text style={styles.subtitle}>
              Both are optional — you can change them anytime in Settings.
            </Text>

            <PermissionRow
              icon="map-marker-outline"
              title="Use my location"
              body="See what's near you and open now."
              enabled={locationOn}
              busy={locBusy}
              onPress={enableLocation}
              styles={styles}
              colors={colors}
            />
            <PermissionRow
              icon="bell-outline"
              title="Turn on notifications"
              body="Likes, comments, follows, and new spots."
              enabled={pushOn}
              busy={pushBusy}
              onPress={enablePush}
              styles={styles}
              colors={colors}
            />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={isLast ? "Done" : "Continue"}
          onPress={next}
          loading={finishing}
        />
      </View>
    </SafeAreaView>
  );
}

function PermissionRow({
  icon,
  title,
  body,
  enabled,
  busy,
  onPress,
  styles,
  colors,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  body: string;
  enabled: boolean;
  busy: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={enabled || busy}
      style={styles.permRow}
      accessibilityRole="button"
    >
      <View style={styles.permIcon}>
        <MaterialCommunityIcons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={styles.permText}>
        <Text style={styles.permTitle}>{title}</Text>
        <Text style={styles.permBody}>{body}</Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : enabled ? (
        <MaterialCommunityIcons
          name="check-circle"
          size={24}
          color={colors.success}
        />
      ) : (
        <Text style={styles.permEnable}>Enable</Text>
      )}
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    iconBtn: {
      width: 52,
      height: 40,
      alignItems: "flex-start",
      justifyContent: "center",
    },
    skipBtn: {
      width: 52,
      height: 40,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    skipText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
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
      marginBottom: spacing.lg,
      lineHeight: 22,
    },
    groupLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.pageBackground,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    chipActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    chipText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    chipTextActive: { fontFamily: fonts.bold, color: colors.primary },
    loader: { paddingVertical: spacing.xxl, alignItems: "center" },
    emptyText: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textMuted,
      paddingVertical: spacing.lg,
    },
    userRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    userText: { flex: 1 },
    userName: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    userHandle: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginTop: 1,
    },
    followBtn: {
      minWidth: 96,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    followingBtn: {
      backgroundColor: colors.cardBackground,
      borderWidth: 1.5,
      borderColor: colors.primary,
    },
    followText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textInverse,
    },
    followingText: { color: colors.primary },
    permRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      marginBottom: spacing.md,
    },
    permIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    permText: { flex: 1 },
    permTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    permBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginTop: 2,
    },
    permEnable: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    footer: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
  });
}
