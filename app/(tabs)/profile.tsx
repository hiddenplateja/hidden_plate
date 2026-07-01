// app/(tabs)/profile.tsx
// Your own profile tab.
//
// Layout:
//   - Top nav row: search icon (left), hamburger menu icon (right)
//   - Thin hairline divider below the nav row
//   - Centered avatar variant of ProfileHeader
//   - Content tabs (All / Likes / Saved) — see ProfileView
//   - Review list filtered by the active tab
//
// Hamburger opens a side drawer with:
//   Settings · Subscriptions · Help · Privacy · Terms · Log Out

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProfileView } from "@/components/ProfileView";
import { SideMenuDrawer, type SideMenuItem } from "@/components/SideMenuDrawer";
import { useAuth } from "@/hooks/useAuth";
import { radius, spacing } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function MyProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const { styles, colors } = useThemedStyles(makeStyles);

  const handleSearch = useCallback(() => {
    router.push("/search-users");
  }, [router]);

  const handleSignOut = useCallback(() => {
    setMenuOpen(false);
    Alert.alert(
      "Sign out?",
      "You'll need to sign in again to use Hidden Plate.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            try {
              await logout();
            } catch (err) {
              Alert.alert(
                "Sign out failed",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ],
    );
  }, [logout]);

  if (!user) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const menuItems: SideMenuItem[] = [
    {
      icon: "plus-box-outline",
      label: "Add a Restaurant",
      onPress: () => {
        setMenuOpen(false);
        router.push("/add-restaurant");
      },
    },
    {
      icon: "storefront-outline",
      label: "Your Restaurants",
      onPress: () => {
        setMenuOpen(false);
        router.push("/my-restaurants");
      },
    },
    {
      icon: "medal-outline",
      label: "Reviewer Badges",
      onPress: () => {
        setMenuOpen(false);
        router.push("/badges");
      },
    },
    {
      icon: "cog-outline",
      label: "Settings",
      onPress: () => {
        setMenuOpen(false);
        router.push("/settings");
      },
    },
    {
      icon: "star-circle-outline",
      label: "My Subscriptions",
      onPress: () => {
        setMenuOpen(false);
        Alert.alert("My Subscriptions", "Subscription management coming soon!");
      },
    },
    {
      icon: "help-circle-outline",
      label: "Help Center",
      onPress: () => {
        setMenuOpen(false);
        Linking.openURL(
          "mailto:support@hiddenplateja.com?subject=App Support Request",
        ).catch(() =>
          Alert.alert(
            "Couldn't open email",
            "Please contact us at support@hiddenplateja.com",
          ),
        );
      },
    },
    {
      icon: "shield-check-outline",
      label: "Privacy Policy",
      onPress: () => {
        setMenuOpen(false);
        router.push("/privacy");
      },
    },
    {
      icon: "file-document-outline",
      label: "Terms & Policies",
      onPress: () => {
        setMenuOpen(false);
        router.push("/terms");
      },
    },
  ];

  const footerItem: SideMenuItem = {
    icon: "logout",
    label: "Log Out",
    danger: true,
    onPress: handleSignOut,
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Top nav row */}
      <View style={styles.topNav}>
        <Pressable
          style={styles.iconBtn}
          onPress={handleSearch}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Find people"
        >
          <MaterialCommunityIcons
            name="account-search-outline"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>

        <Pressable
          style={styles.iconBtn}
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <MaterialCommunityIcons
            name="menu"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
      </View>

      {/* Profile content */}
      <ProfileView
        userId={user.id}
        isOwn
        variant="centered"
        onEditPress={() => router.push("/edit-profile")}
        onFollowersPress={() =>
          router.push({
            pathname: "/follows/[type]",
            params: { type: "followers", userId: user.id },
          })
        }
        onFollowingPress={() =>
          router.push({
            pathname: "/follows/[type]",
            params: { type: "following", userId: user.id },
          })
        }
      />

      {/* Side menu drawer */}
      <SideMenuDrawer
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Menu"
        user={user}
        items={menuItems}
        footer={footerItem}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Whole screen — matches Community and Saved
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  topNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.cardBackground,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.cardBackground,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.divider,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBackground,
  },
  });
}
