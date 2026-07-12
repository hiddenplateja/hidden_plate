// src/components/AppGateProvider.tsx
// Reads the app gating config (services/remoteConfig, backed by the Appwrite
// `acontrol` doc) at launch and whenever the app returns to the foreground,
// then gates the whole app accordingly:
//
//   maintenance       → full-screen "We'll be right back" (blocks everyone)
//   update-required   → full-screen "Update required"     (blocks until updated)
//   update-optional   → dismissible "Update available" sheet over the app
//   ok                → renders children untouched
//
// Mounted high in the tree (inside ThemeProvider, around AuthProvider) so a
// block hides auth and every tab. Starts in "ok" and swaps in a blocking screen
// once the fetch resolves — the fetch overlaps the auth/font splash, so a real
// block lands before the app is interactive. Fail-open lives in remoteConfig.

import { CircleArrowUp, Rocket, Wrench, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fetchAppGate, type AppGate } from "@/services/remoteConfig";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

function openStore(url: string) {
  if (url) Linking.openURL(url).catch(() => {});
}

export function AppGateProvider({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<AppGate>({ status: "ok" });
  // Optional-update dismissal is per-session: nudge again on next launch.
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(() => {
    fetchAppGate()
      .then(setGate)
      .catch(() => setGate({ status: "ok" }));
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // Re-check when the app is brought back to the foreground so flipping
  // maintenance mode catches users who already had the app open.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  if (gate.status === "maintenance") {
    return (
      <BlockScreen
        icon={Wrench}
        title="We'll be right back"
        message={gate.message}
        actionLabel="Try again"
        onAction={check}
      />
    );
  }

  if (gate.status === "update-required") {
    return (
      <BlockScreen
        icon={Rocket}
        title="Update required"
        message={gate.message}
        actionLabel="Update now"
        onAction={() => openStore(gate.storeUrl)}
        actionDisabled={!gate.storeUrl}
      />
    );
  }

  return (
    <>
      {children}
      {gate.status === "update-optional" && !dismissed ? (
        <UpdateAvailableSheet
          message={gate.message}
          storeUrl={gate.storeUrl}
          onUpdate={() => openStore(gate.storeUrl)}
          onDismiss={() => setDismissed(true)}
        />
      ) : null}
    </>
  );
}

// ── Full-screen blocking view (maintenance + forced update) ──────────────────

function BlockScreen({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  actionDisabled = false,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const Icon = icon;
  return (
    <SafeAreaView style={styles.blockSafe} edges={["top", "bottom"]}>
      <View style={styles.blockBody}>
        <View style={styles.iconTile}>
          <Icon size={38} color={colors.primary} strokeWidth={1.8} />
        </View>
        <Text style={styles.blockTitle}>{title}</Text>
        <Text style={styles.blockMessage}>{message}</Text>
      </View>
      <View style={styles.blockFooter}>
        <Pressable
          onPress={onAction}
          disabled={actionDisabled}
          style={({ pressed }) => [
            styles.primaryBtn,
            actionDisabled && styles.primaryBtnDisabled,
            pressed && !actionDisabled && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── Dismissible optional-update sheet ────────────────────────────────────────

function UpdateAvailableSheet({
  message,
  storeUrl,
  onUpdate,
  onDismiss,
}: {
  message: string;
  storeUrl: string;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.iconTileSm}>
            <CircleArrowUp size={26} color={colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.sheetTitle}>Update available</Text>
          <Text style={styles.sheetMessage}>{message}</Text>
          <Pressable
            onPress={onUpdate}
            disabled={!storeUrl}
            style={({ pressed }) => [
              styles.primaryBtn,
              !storeUrl && styles.primaryBtnDisabled,
              pressed && !!storeUrl && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Update now</Text>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            style={styles.secondaryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    // Blocking screen
    blockSafe: { flex: 1, backgroundColor: colors.cardBackground },
    blockBody: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
    },
    iconTile: {
      width: 88,
      height: 88,
      borderRadius: radius.xl,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xl,
    },
    blockTitle: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      textAlign: "center",
      letterSpacing: T.tracking.tight,
    },
    blockMessage: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: spacing.md,
      lineHeight: 22,
    },
    blockFooter: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.lg,
    },
    // Optional-update sheet
    scrim: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
      alignItems: "center",
    },
    iconTileSm: {
      width: 56,
      height: 56,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    sheetTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
      color: colors.textPrimary,
    },
    sheetMessage: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
      lineHeight: 22,
    },
    // Shared buttons
    primaryBtn: {
      width: "100%",
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.onPrimary,
    },
    secondaryBtn: {
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.xs,
    },
    secondaryBtnText: {
      fontFamily: fonts.medium,
      fontSize: T.size.base,
      color: colors.textMuted,
    },
    pressed: { opacity: 0.85 },
  });
}
