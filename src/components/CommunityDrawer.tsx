// src/components/CommunityDrawer.tsx
// Left slide-in account drawer, opened by tapping the avatar on the Community
// header. Shows the signed-in user (avatar + name + @username, tap → profile),
// then a list of navigation items and an optional footer (e.g. Log Out).
//
// Slides in from the LEFT via reanimated's SlideInLeft. The backdrop dims via
// the Modal's fade. Tap the dimmed area (or an item) to close.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInLeft } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { User } from "@/types/user";

export interface DrawerNavItem {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface CommunityDrawerProps {
  visible: boolean;
  onClose: () => void;
  user: User | null;
  items: DrawerNavItem[];
  footer?: DrawerNavItem;
  /** Tap the profile header (avatar + name). */
  onProfilePress: () => void;
  /** Follower/following counts shown under the name. Hidden when absent. */
  follow?: { followerCount: number; followingCount: number };
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
  /** Renders the "Go Premium" CTA when provided. */
  onPremiumPress?: () => void;
}

export function CommunityDrawer({
  visible,
  onClose,
  user,
  items,
  footer,
  onProfilePress,
  follow,
  onFollowersPress,
  onFollowingPress,
  onPremiumPress,
}: CommunityDrawerProps) {
  // The panel is edge-to-edge (navigationBarTranslucent), so the footer needs
  // explicit bottom clearance. Some Android devices under-report the bottom
  // inset (it can be 0 even with a visible nav bar), so floor it at a real
  // nav-bar height to keep Log Out from being cut off.
  const insets = useSafeAreaInsets();
  const footerBottom = Math.max(insets.bottom, 48);
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Tap the dimmed area to close. The panel stops propagation. */}
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View entering={SlideInLeft.duration(240)} style={styles.panel}>
          <Pressable style={styles.panelInner} onPress={() => {}}>
            <SafeAreaView style={styles.safe} edges={["top"]}>
              {/* Profile header */}
              <Pressable
                style={styles.profile}
                onPress={onProfilePress}
                accessibilityRole="button"
                accessibilityLabel="Open your profile"
              >
                <Avatar
                  fileId={user?.avatarUrl}
                  displayName={user?.displayName ?? ""}
                  userId={user?.id ?? ""}
                  size={56}
                />
                <View style={styles.profileText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {user?.displayName ?? "You"}
                  </Text>
                  {user?.username ? (
                    <Text style={styles.handle} numberOfLines={1}>
                      @{user.username}
                    </Text>
                  ) : null}
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>

              {follow ? (
                <View style={styles.stats}>
                  <Pressable
                    style={styles.stat}
                    onPress={onFollowingPress}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Following"
                  >
                    <Text style={styles.statValue}>
                      {formatCount(follow.followingCount)}{" "}
                    </Text>
                    <Text style={styles.statLabel}>Following</Text>
                  </Pressable>
                  <Pressable
                    style={styles.stat}
                    onPress={onFollowersPress}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Followers"
                  >
                    <Text style={styles.statValue}>
                      {formatCount(follow.followerCount)}{" "}
                    </Text>
                    <Text style={styles.statLabel}>Followers</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.divider} />

              {onPremiumPress ? (
                <Pressable
                  style={styles.premium}
                  onPress={onPremiumPress}
                  accessibilityRole="button"
                  accessibilityLabel="Go Premium"
                >
                  <View style={styles.premiumIcon}>
                    <MaterialCommunityIcons
                      name="crown"
                      size={20}
                      color={colors.star}
                    />
                  </View>
                  <View style={styles.premiumText}>
                    <Text style={styles.premiumTitle}>Go Premium</Text>
                    <Text style={styles.premiumSub}>
                      Unlock more features
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.star}
                  />
                </Pressable>
              ) : null}

              <View style={styles.items}>
                {items.map((item) => (
                  <DrawerItem key={item.label} item={item} />
                ))}
              </View>

              <View style={styles.spacer} />

              {footer ? (
                <View style={{ paddingBottom: footerBottom }}>
                  <DrawerItem item={footer} />
                </View>
              ) : null}
            </SafeAreaView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function DrawerItem({ item }: { item: DrawerNavItem }) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={item.onPress}
      android_ripple={{ color: colors.pageBackground }}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <View style={[styles.iconWrap, item.danger && styles.iconWrapDanger]}>
        <MaterialCommunityIcons
          name={item.icon}
          size={22}
          color={item.danger ? colors.error : colors.textPrimary}
        />
      </View>
      <Text style={[styles.itemLabel, item.danger && styles.itemLabelDanger]}>
        {item.label}
      </Text>
      {!item.danger ? (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={colors.textMuted}
        />
      ) : null}
    </Pressable>
  );
}

// Compact count: 1234 → "1.2k".
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  panel: {
    width: "80%",
    maxWidth: 340,
    height: "100%",
    backgroundColor: colors.cardBackground,
    ...shadows.md,
  },
  panelInner: { flex: 1 },
  safe: { flex: 1 },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  profileText: { flex: 1 },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  handle: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  stats: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  stat: { flexDirection: "row", alignItems: "baseline" },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  premium: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#FFF7E6",
    borderWidth: 1,
    borderColor: "#F2D98B",
  },
  premiumIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: "#FBEFC9",
    alignItems: "center",
    justifyContent: "center",
  },
  premiumText: { flex: 1 },
  premiumTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    // Fixed dark ink — the premium card stays cream/gold in both themes.
    color: "#2A1A0A",
  },
  premiumSub: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: "rgba(42,26,10,0.7)",
    marginTop: 1,
  },
  items: { paddingTop: spacing.xs },
  spacer: { flex: 1 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  itemPressed: { backgroundColor: colors.pageBackground },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDanger: { backgroundColor: colors.errorBg },
  itemLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  itemLabelDanger: { color: colors.error, fontFamily: fonts.bold },
  });
}
