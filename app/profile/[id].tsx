// app/profile/[id].tsx
// View another user's profile. Reached by tapping a review author.
//
// Uses the shared <ProfileView> with isOwn auto-detected from the current user.
// Shows a Back button in a header bar since this isn't a tab.

import { ArrowLeft } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProfileView } from "@/components/ProfileView";
import { useAuth } from "@/hooks/useAuth";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  if (!id) {
    return (
      <SafeAreaView style={styles.errorContainer} edges={["top"]}>
        <Text style={styles.errorText}>Invalid profile.</Text>
      </SafeAreaView>
    );
  }

  const isOwn = user?.id === id;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header with back button */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
      </View>

      <ProfileView
        userId={id}
        isOwn={isOwn}
        onEditPress={isOwn ? () => router.push("/edit-profile") : undefined}
        onFollowersPress={() =>
          router.push({
            pathname: "/follows/[type]",
            params: { type: "followers", userId: id },
          })
        }
        onFollowingPress={() =>
          router.push({
            pathname: "/follows/[type]",
            params: { type: "following", userId: id },
          })
        }
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
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
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  });
}
