// app/(tabs)/_layout.tsx
// Bottom tab navigator — Discover · Saved · Map · Community · Profile
//
// Why we read the bottom safe-area inset:
// On devices with a home indicator (iPhone X+) or gesture-nav (modern
// Android), the OS reserves a slim strip at the very bottom of the screen
// for its own navigation hints. A fixed-height tab bar sits underneath
// that strip, causing labels/icons to be clipped or overlap with the
// system UI.
//
// We add the bottom inset to both the bar's height and its bottom padding
// so the tappable content lives above the OS area. On devices without an
// indicator (older Android, on-screen buttons), the inset is 0 and the
// bar reverts to its base dimensions.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts } from "@/theme/colors";

const TAB_BAR_BASE_HEIGHT = 60;
const TAB_BAR_BASE_PADDING_BOTTOM = 8;
const TAB_BAR_PADDING_TOP = 6;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.cardBackground,
          borderTopColor: colors.divider,
          // Grow the bar to clear the system nav / home indicator area
          height: TAB_BAR_BASE_HEIGHT + insets.bottom,
          paddingBottom: TAB_BAR_BASE_PADDING_BOTTOM + insets.bottom,
          paddingTop: TAB_BAR_PADDING_TOP,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: "Saved",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="bookmark-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="map-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="account-group-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="account-circle-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
