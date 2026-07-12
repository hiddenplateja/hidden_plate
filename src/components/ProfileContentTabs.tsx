// src/components/ProfileContentTabs.tsx
// Tab strip used on profile screens to switch between:
//   - reviews ("all"): the user's own reviews
//   - likes:           reviews the user has liked
//   - lists:           the user's collections
//
// Icon + label tabs with an active underline indicator. The bar has clear
// breathing room above it (from the header's bottom padding) and a single
// bottom hairline so it reads as its own band — it never visually collides
// with the stats above or the first review card below (the parent adds a
// spacer beneath this bar so the first card doesn't jam the hairline).
//
// Saved lives on its own bottom-nav tab — it's intentionally NOT a profile
// tab (it used to be; removed to keep the profile focused on public content).

import {
  Heart,
  LayoutGrid,
  Library,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export type ProfileContentTab = "all" | "likes" | "lists";

interface ProfileContentTabsProps {
  active: ProfileContentTab;
  onChange: (tab: ProfileContentTab) => void;
  /** When false, the Lists (Collections) tab is hidden (feature disabled). */
  showLists?: boolean;
}

interface TabSpec {
  id: ProfileContentTab;
  icon: LucideIcon;
  label: string;
}

const ALL_TABS: TabSpec[] = [
  { id: "all", icon: LayoutGrid, label: "Reviews" },
  { id: "likes", icon: Heart, label: "Likes" },
  { id: "lists", icon: Library, label: "Lists" },
];

export function ProfileContentTabs({
  active,
  onChange,
  showLists = true,
}: ProfileContentTabsProps) {
  const tabs = ALL_TABS.filter((t) => t.id !== "lists" || showLists);
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.icon;
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
              <Icon
                size={17}
                color={isActive ? colors.primary : colors.textMuted}
                strokeWidth={isActive ? 2.4 : 2}
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
