// src/components/ProfileContentTabs.tsx
// Tab strip used on profile screens to switch between:
//   - reviews ("all"): the user's own reviews
//   - likes:           reviews the user has liked
//   - saved:           restaurants the user has saved  (own profile only)
//
// Icon + label tabs with an active underline indicator. The bar has clear
// breathing room above it (from the header's bottom padding) and a single
// bottom hairline so it reads as its own band — it never visually collides
// with the stats above or the first review card below (the parent adds a
// spacer beneath this bar so the first card doesn't jam the hairline).
//
// Saved is private (per-doc Read scoped to the owner only), so the tab is
// hidden entirely when viewing someone else's profile.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export type ProfileContentTab = "all" | "likes" | "lists" | "saved";

interface ProfileContentTabsProps {
  active: ProfileContentTab;
  onChange: (tab: ProfileContentTab) => void;
  /**
   * When false, the Saved tab is hidden. Other users' saved lists are
   * private by design — the data layer enforces this too.
   */
  isOwn?: boolean;
  /** When false, the Lists (Collections) tab is hidden (feature disabled). */
  showLists?: boolean;
}

interface TabSpec {
  id: ProfileContentTab;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
}

const ALL_TABS: TabSpec[] = [
  { id: "all", icon: "grid", label: "Reviews" },
  { id: "likes", icon: "heart-outline", label: "Likes" },
  { id: "lists", icon: "bookmark-multiple-outline", label: "Lists" },
  { id: "saved", icon: "bookmark-outline", label: "Saved" },
];

export function ProfileContentTabs({
  active,
  onChange,
  isOwn = true,
  showLists = true,
}: ProfileContentTabsProps) {
  const tabs = ALL_TABS.filter(
    (t) => (t.id !== "saved" || isOwn) && (t.id !== "lists" || showLists),
  );
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            hitSlop={4}
          >
            <View style={styles.tabInner}>
              <MaterialCommunityIcons
                name={tab.icon}
                size={19}
                color={isActive ? colors.primary : colors.textMuted}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {tab.label}
              </Text>
            </View>
            <View
              style={[styles.underline, isActive && styles.underlineActive]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tab: {
    flex: 1,
    alignItems: "center",
  },
  // Icon + label sit on one centered row; vertical padding gives the bar a
  // comfortable height so it reads as its own section.
  tabInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm + 2,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  labelActive: {
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  // Full-width indicator beneath the active tab (Material-style). Transparent
  // when inactive so the icon/label never shift on selection.
  underline: {
    height: 2.5,
    width: "100%",
    backgroundColor: "transparent",
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
  },
  underlineActive: {
    backgroundColor: colors.primary,
  },
  });
}
