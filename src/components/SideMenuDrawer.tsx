// src/components/SideMenuDrawer.tsx
// Right-side slide-in account menu for the profile tab.
//
// Modern layout: a profile header (avatar + name + @handle), an Appearance
// segmented control (Light / Dark / Auto), the navigation items as clean rows
// with tinted icon tiles, and a pinned footer (Sign out). Fully theme-aware —
// styles are built from the active palette via useTheme().

import {
  ChevronRight,
  Moon,
  Sun,
  SunMoon,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import type { ThemeColors } from "@/theme/themes";
import type { User } from "@/types/user";

export interface SideMenuItem {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface SideMenuDrawerProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  items: SideMenuItem[];
  footer?: SideMenuItem;
  /** Signed-in user, shown in the header. */
  user?: User | null;
}

const THEME_OPTIONS: {
  mode: ThemeMode;
  label: string;
  icon: LucideIcon;
}[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "Auto", icon: SunMoon },
];

export function SideMenuDrawer({
  visible,
  onClose,
  title = "Menu",
  items,
  footer,
  user,
}: SideMenuDrawerProps) {
  const { colors, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const renderItem = (item: SideMenuItem) => {
    const Icon = item.icon;
    return (
      <Pressable
        key={item.label}
        onPress={item.onPress}
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        accessibilityRole="button"
        accessibilityLabel={item.label}
      >
        <View style={[styles.iconTile, item.danger && styles.iconTileDanger]}>
          <Icon
            size={19}
            color={item.danger ? colors.error : colors.primary}
            strokeWidth={2}
          />
        </View>
        <Text style={[styles.itemLabel, item.danger && styles.itemLabelDanger]}>
          {item.label}
        </Text>
        {!item.danger ? (
          <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View entering={SlideInRight.duration(240)} style={styles.panel}>
          <Pressable style={styles.panelInner} onPress={() => {}}>
            <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.headerTitle}>{title}</Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close menu"
                >
                  <X size={20} color={colors.textPrimary} strokeWidth={2.2} />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
              >
                {/* Profile card */}
                {user ? (
                  <View style={styles.profile}>
                    <Avatar
                      fileId={user.avatarUrl}
                      displayName={user.displayName}
                      userId={user.id}
                      size={52}
                    />
                    <View style={styles.profileText}>
                      <Text style={styles.profileName} numberOfLines={1}>
                        {user.displayName}
                      </Text>
                      <Text style={styles.profileHandle} numberOfLines={1}>
                        @{user.username}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Appearance */}
                <Text style={styles.sectionLabel}>Appearance</Text>
                <View style={styles.segmented}>
                  {THEME_OPTIONS.map((opt) => {
                    const active = mode === opt.mode;
                    const OptIcon = opt.icon;
                    return (
                      <Pressable
                        key={opt.mode}
                        onPress={() => setMode(opt.mode)}
                        style={[styles.segment, active && styles.segmentActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${opt.label} theme`}
                      >
                        <OptIcon
                          size={15}
                          color={active ? colors.primary : colors.textMuted}
                          strokeWidth={2}
                        />
                        <Text
                          style={[
                            styles.segmentLabel,
                            active && styles.segmentLabelActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Items */}
                <View style={styles.itemsCard}>{items.map(renderItem)}</View>
              </ScrollView>

              {footer ? <View style={styles.footer}>{renderItem(footer)}</View> : null}
            </SafeAreaView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    // One clean surface — no grey page behind floating white cards.
    panel: {
      width: "84%",
      maxWidth: 380,
      height: "100%",
      backgroundColor: c.cardBackground,
    },
    panelInner: { flex: 1 },
    safe: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    headerTitle: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: c.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    closeBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
    // Profile header — borderless, separated by a hairline rule + whitespace.
    profile: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    profileText: { flex: 1 },
    profileName: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: c.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    profileHandle: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: c.textMuted,
      marginTop: 2,
    },
    sectionLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
      marginBottom: spacing.sm,
    },
    // Bordered (not filled) segmented control — stays on the white surface.
    segmented: {
      flexDirection: "row",
      borderRadius: radius.md,
      padding: 3,
      gap: 3,
      marginBottom: spacing.xl,
      borderWidth: 1,
      borderColor: c.divider,
    },
    segment: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
    },
    segmentActive: { backgroundColor: c.primaryLight },
    segmentLabel: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: c.textMuted,
    },
    segmentLabelActive: { color: c.primary, fontFamily: fonts.bold },
    // Items sit directly on the white surface, separated by whitespace.
    itemsCard: { gap: spacing.xs },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm + 3,
      borderRadius: radius.md,
    },
    itemPressed: { backgroundColor: c.primaryLight },
    // Brand-tinted tile (coral), not grey.
    iconTile: {
      width: 38,
      height: 38,
      borderRadius: radius.md,
      backgroundColor: c.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    iconTileDanger: { backgroundColor: c.errorBg },
    itemLabel: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: T.size.base,
      color: c.textPrimary,
    },
    itemLabelDanger: { color: c.error, fontFamily: fonts.bold },
    footer: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
  });
}
