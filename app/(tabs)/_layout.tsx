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

import { Tabs } from "expo-router";
import {
  Bookmark,
  CircleUserRound,
  House,
  Map,
  Users,
} from "lucide-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, shadows } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";

const TAB_BAR_BASE_HEIGHT = 60;
const TAB_BAR_BASE_PADDING_BOTTOM = 8;
const TAB_BAR_PADDING_TOP = 6;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

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
          tabBarIcon: ({ color, size, focused }) => (
            <House size={size} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: "Saved",
          tabBarIcon: ({ color, size, focused }) => (
            <Bookmark
              size={size}
              color={color}
              strokeWidth={focused ? 2.4 : 2}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          // Raised above the other tabs — an elevated circular tile that pops
          // off the bar (ink when active, light surface when not).
          tabBarIcon: ({ focused, color }) => (
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                alignItems: "center",
                justifyContent: "center",
                transform: [{ translateY: -14 }],
                borderWidth: 3,
                borderColor: colors.cardBackground,
                backgroundColor: focused ? colors.primary : colors.surface,
                ...shadows.sm,
              }}
            >
              <Map
                size={22}
                color={focused ? colors.onPrimary : color}
                strokeWidth={2}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color, size, focused }) => (
            <Users size={size} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <CircleUserRound
              size={size}
              color={color}
              strokeWidth={focused ? 2.4 : 2}
            />
          ),
        }}
      />
    </Tabs>
  );
}
