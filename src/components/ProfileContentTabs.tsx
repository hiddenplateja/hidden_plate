// src/components/ProfileContentTabs.tsx
// Icon-only tab strip used on profile screens to switch between:
//   - reviews ("all"): the user's own reviews
//   - likes:           reviews the user has liked
//   - saved:           restaurants the user has saved
//
// Visual style mirrors Community + Saved: large tap target with a centered
// icon, a small underline bar beneath that's transparent when inactive and
// blue when active. No labels — icons only, per design.
//
// Right now only the "all" tab actually has wired-up data in ProfileView.
// The other two render their own empty placeholder for now; we'll wire the
// data layer in a follow-up.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "@/theme/colors";

export type ProfileContentTab = "all" | "likes" | "saved";

interface ProfileContentTabsProps {
  active: ProfileContentTab;
  onChange: (tab: ProfileContentTab) => void;
}

interface TabSpec {
  id: ProfileContentTab;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string; // for a11y only — not displayed
}

const TABS: TabSpec[] = [
  { id: "all", icon: "grid", label: "All reviews" },
  { id: "likes", icon: "heart-outline", label: "Liked reviews" },
  { id: "saved", icon: "bookmark-outline", label: "Saved restaurants" },
];

export function ProfileContentTabs({
  active,
  onChange,
}: ProfileContentTabsProps) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
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
            <MaterialCommunityIcons
              name={tab.icon}
              size={22}
              color={isActive ? colors.textPrimary : colors.textMuted}
              style={styles.icon}
            />
            <View
              style={[styles.underline, isActive && styles.underlineActive]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.md,
    paddingBottom: 0,
  },
  icon: { marginBottom: spacing.sm },
  // Underline bar — always present so the icon doesn't shift on selection.
  // Transparent when inactive, primary color when active.
  underline: {
    height: 3,
    width: 36,
    borderRadius: radius.sm,
    backgroundColor: "transparent",
  },
  underlineActive: {
    backgroundColor: colors.primary,
  },
});
