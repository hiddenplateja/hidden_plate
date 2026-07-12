// src/components/ProfileHeader.tsx
// Top section of a profile screen.
//
// Two variants:
//   variant="centered" — your own profile tab. Centered avatar with an edit
//     pencil overlay, centered name/handle/bio, then a minimal stats row.
//     No follow button (it's your profile). No separate "Edit Profile" pill
//     either — the pencil overlay is the single edit affordance.
//   variant="default" — viewing another user. Left-aligned avatar with a ⋯
//     overflow + Follow button on the right, then name/handle/bio, then the
//     same stats row.
//
// Block/Unblock (default variant, other users only):
//   - A ⋯ button next to Follow opens a bottom action sheet with
//     "Block @user" (destructive) or "Unblock @user".
//   - When blocked, the Follow button is replaced by a muted "Blocked" pill
//     (state indicator); the ⋯ menu offers Unblock.
//   - State + the actual block/unblock call are owned by ProfileView and
//     passed in via isBlocked / onToggleBlock, mirroring the follow wiring.
//
// Stats row design notes:
//   - No bordered card, no background fill — just open whitespace
//   - Big bold numbers, tiny grey labels beneath
//   - Vertical hairline dividers between stats (drawn 1px wide, short)
//   - Secondary line (★ avg · parishes) sits below in muted grey
//
// This style matches the rest of the white-blended UI on Community/Saved.

import { useRouter } from "expo-router";
import { Ban, Ellipsis, Pencil, Star, UserCheck } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Avatar } from "@/components/Avatar";
import { DraggableSheet } from "@/components/DraggableSheet";
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
import { badgeToneColor } from "@/utils/badgeTone";
import { getReviewerBadges } from "@/utils/reviewerBadges";

interface ProfileStats {
  reviewCount: number;
  averageRating: number;
  parishesVisited: number;
}

interface FollowState {
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
}

type Variant = "centered" | "default";

interface ProfileHeaderProps {
  user: User;
  stats: ProfileStats;
  follow: FollowState;
  isOwn: boolean;
  variant?: Variant;
  onEditPress?: () => void;
  onToggleFollow?: () => Promise<void>;
  /** Whether the current user has blocked this profile's user. */
  isBlocked?: boolean;
  /** Block/unblock toggle — owned by ProfileView. Absent on own profile. */
  onToggleBlock?: () => Promise<void>;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

export function ProfileHeader({
  user,
  stats,
  follow,
  isOwn,
  variant = "default",
  onEditPress,
  onToggleFollow,
  isBlocked = false,
  onToggleBlock,
  onFollowersPress,
  onFollowingPress,
}: ProfileHeaderProps) {
  const [busy, setBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { styles, colors } = useThemedStyles(makeSharedStyles);
  const centeredContainer = useThemedStyles(makeCenteredContainer).styles;
  const centeredStyles = useThemedStyles(makeCenteredStyles).styles;
  const defaultStyles = useThemedStyles(makeDefaultStyles).styles;
  const sheetStyles = useThemedStyles(makeSheetStyles).styles;

  const handleFollowPress = useCallback(async () => {
    if (busy || !onToggleFollow) return;
    setBusy(true);
    try {
      await onToggleFollow();
    } finally {
      setBusy(false);
    }
  }, [busy, onToggleFollow]);

  const handleBlockPress = useCallback(async () => {
    if (blockBusy || !onToggleBlock) return;
    setMenuOpen(false);
    setBlockBusy(true);
    try {
      await onToggleBlock();
    } finally {
      setBlockBusy(false);
    }
  }, [blockBusy, onToggleBlock]);

  if (variant === "centered") {
    return (
      <View style={centeredContainer.container}>
        {/* Centered avatar with edit pencil overlay — the pencil is the
            single edit entry point on own profile. */}
        <View style={centeredStyles.avatarWrap}>
          <Avatar
            fileId={user.avatarUrl}
            displayName={user.displayName}
            userId={user.id}
            size={80}
            viewable
          />
          {isOwn && onEditPress ? (
            <Pressable
              style={centeredStyles.editBadge}
              onPress={onEditPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Pencil size={13} color={colors.onPrimary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        <Text style={centeredStyles.displayName} numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text style={centeredStyles.username}>@{user.username}</Text>

        {user.bio ? (
          <Text style={centeredStyles.bio}>{user.bio}</Text>
        ) : isOwn ? (
          <Text style={centeredStyles.bioPlaceholder}>No bio yet.</Text>
        ) : null}

        <StatsRow
          stats={stats}
          follow={follow}
          marginTop={spacing.md}
          onFollowersPress={onFollowersPress}
          onFollowingPress={onFollowingPress}
        />

        {stats.reviewCount > 0 ? <SecondaryLine stats={stats} /> : null}

        <BadgesRow stats={stats} userId={user.id} />
      </View>
    );
  }

  // ---------- Default variant (viewing another user) ----------
  const showFollow = !isOwn && !!onToggleFollow && !isBlocked;
  const showBlockedPill = !isOwn && !!onToggleBlock && isBlocked;
  const showMenu = !isOwn && !!onToggleBlock;

  return (
    <View style={styles.container}>
      <View style={defaultStyles.avatarRow}>
        <Avatar
          fileId={user.avatarUrl}
          displayName={user.displayName}
          userId={user.id}
          size={88}
          viewable
        />

        <View style={defaultStyles.actions}>
          {showMenu ? (
            <Pressable
              onPress={() => setMenuOpen(true)}
              disabled={blockBusy}
              hitSlop={8}
              style={({ pressed }) => [
                defaultStyles.menuBtn,
                pressed && defaultStyles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              {blockBusy ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Ellipsis size={20} color={colors.textPrimary} strokeWidth={2} />
              )}
            </Pressable>
          ) : null}

          {showFollow ? (
            <Pressable
              onPress={handleFollowPress}
              disabled={busy}
              style={({ pressed }) => [
                follow.isFollowing
                  ? defaultStyles.followingButton
                  : defaultStyles.followButton,
                pressed && defaultStyles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                follow.isFollowing
                  ? `Unfollow ${user.displayName}`
                  : `Follow ${user.displayName}`
              }
            >
              {busy ? (
                <ActivityIndicator
                  size="small"
                  color={
                    follow.isFollowing ? colors.primary : colors.onPrimary
                  }
                />
              ) : (
                <Text
                  style={
                    follow.isFollowing
                      ? defaultStyles.followingButtonText
                      : defaultStyles.followButtonText
                  }
                >
                  {follow.isFollowing ? "Following" : "Follow"}
                </Text>
              )}
            </Pressable>
          ) : showBlockedPill ? (
            <View style={defaultStyles.blockedPill}>
              <Text style={defaultStyles.blockedPillText}>Blocked</Text>
            </View>
          ) : isOwn && onEditPress ? (
            <Pressable
              onPress={onEditPress}
              style={({ pressed }) => [
                defaultStyles.editButton,
                pressed && defaultStyles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Text style={defaultStyles.editButtonText}>Edit Profile</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Text style={defaultStyles.displayName} numberOfLines={1}>
        {user.displayName}
      </Text>
      <Text style={defaultStyles.username}>@{user.username}</Text>

      {user.bio ? <Text style={defaultStyles.bio}>{user.bio}</Text> : null}

      <StatsRow
        stats={stats}
        follow={follow}
        onFollowersPress={onFollowersPress}
        onFollowingPress={onFollowingPress}
      />

      {stats.reviewCount > 0 ? <SecondaryLine stats={stats} /> : null}

      <BadgesRow stats={stats} userId={user.id} />

      {/* Block/Unblock action sheet */}
      {showMenu ? (
        <DraggableSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
        >
          <Text style={sheetStyles.title} numberOfLines={1}>
            @{user.username}
          </Text>
          <View style={sheetStyles.divider} />

          <Pressable
            onPress={handleBlockPress}
            style={({ pressed }) => [
              sheetStyles.action,
              pressed && defaultStyles.pressed,
            ]}
            accessibilityRole="button"
          >
            {isBlocked ? (
              <UserCheck size={19} color={colors.textPrimary} strokeWidth={2} />
            ) : (
              <Ban size={19} color={colors.error} strokeWidth={2} />
            )}
            <Text
              style={[
                sheetStyles.actionText,
                !isBlocked && sheetStyles.actionTextDestructive,
              ]}
            >
              {isBlocked
                ? `Unblock @${user.username}`
                : `Block @${user.username}`}
            </Text>
          </Pressable>

          <View style={sheetStyles.divider} />

          <Pressable
            onPress={() => setMenuOpen(false)}
            style={({ pressed }) => [
              sheetStyles.action,
              pressed && defaultStyles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={sheetStyles.cancelText}>Cancel</Text>
          </Pressable>
        </DraggableSheet>
      ) : null}
    </View>
  );
}

// ---------- Stats row (shared) ----------

interface StatsRowProps {
  stats: ProfileStats;
  follow: FollowState;
  /** Override the default top margin (defaults to spacing.lg). The centered
   *  variant overrides this to tighten its layout. */
  marginTop?: number;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

function StatsRow({
  stats,
  follow,
  marginTop,
  onFollowersPress,
  onFollowingPress,
}: StatsRowProps) {
  const { styles } = useThemedStyles(makeSharedStyles);
  return (
    <View style={[styles.statsRow, marginTop != null && { marginTop }]}>
      <StatBlock
        label={stats.reviewCount === 1 ? "Review" : "Reviews"}
        value={formatCount(stats.reviewCount)}
      />
      <View style={styles.statDivider} />
      <StatBlock
        label={follow.followerCount === 1 ? "Follower" : "Followers"}
        value={formatCount(follow.followerCount)}
        onPress={onFollowersPress}
      />
      <View style={styles.statDivider} />
      <StatBlock
        label="Following"
        value={formatCount(follow.followingCount)}
        onPress={onFollowingPress}
      />
    </View>
  );
}

function SecondaryLine({ stats }: { stats: ProfileStats }) {
  const { styles, colors } = useThemedStyles(makeSharedStyles);
  return (
    <View style={styles.secondaryStats}>
      <Star size={13} color={colors.star} fill={colors.star} />
      <Text style={styles.secondaryStat}>
        {stats.averageRating.toFixed(1)} avg
      </Text>
      <Text style={styles.secondaryDot}>·</Text>
      <Text style={styles.secondaryStat}>
        {stats.parishesVisited}{" "}
        {stats.parishesVisited === 1 ? "parish" : "parishes"}
      </Text>
    </View>
  );
}

// Reputation badges earned from review volume + parish coverage, shown as
// colored "medal" cards (icon + tier name + what earned it). Tapping a badge
// opens the full tier guide — which also shows your progress to the next tier.
// Renders nothing until at least one badge is earned.
function BadgesRow({ stats, userId }: { stats: ProfileStats; userId: string }) {
  const { styles, colors } = useThemedStyles(makeSharedStyles);
  const router = useRouter();
  const badges = getReviewerBadges(stats);
  if (badges.length === 0) return null;

  const openGuide = () =>
    router.push({ pathname: "/badges", params: { userId } });

  return (
    <View style={styles.badgesSection}>
      <View style={styles.badgesRow}>
        {badges.map((b) => {
          const tc = badgeToneColor(b.tone, colors);
          return (
            <Pressable
              key={b.id}
              onPress={openGuide}
              accessibilityRole="button"
              accessibilityLabel={`${b.label}, ${b.requirement}. See how badges work`}
              style={({ pressed }) => [
                styles.badge,
                { backgroundColor: tc + "14", borderColor: tc + "33" },
                pressed && styles.badgePressed,
              ]}
            >
              <View style={[styles.badgeMedal, { backgroundColor: tc }]}>
                <b.icon size={15} color={colors.white} strokeWidth={2} />
              </View>
              <View style={styles.badgeTextWrap}>
                <Text style={styles.badgeLabel} numberOfLines={1}>
                  {b.label}
                </Text>
                <Text style={styles.badgeReq} numberOfLines={1}>
                  {b.requirement}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface StatBlockProps {
  label: string;
  value: string;
  onPress?: () => void;
}

function StatBlock({ label, value, onPress }: StatBlockProps) {
  const { styles } = useThemedStyles(makeSharedStyles);
  const content = (
    <>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.statBlock,
          pressed && styles.statBlockPressed,
        ]}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.statBlock}>{content}</View>;
}

function formatCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ---------- Shared styles ----------

function makeSharedStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  // Minimal stats row — no card, no border, just whitespace
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  statBlock: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.xs,
  },
  statBlockPressed: { opacity: 0.5 },
  statValue: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    lineHeight: T.size.xxl * 1.1,
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  // Vertical hairlines between stats — short, faint, not full-height
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: colors.divider,
  },
  secondaryStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  secondaryStat: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  secondaryDot: {
    color: colors.textMuted,
    fontSize: T.size.xs,
    marginHorizontal: spacing.xs / 2,
  },
  badgesSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  // Medal card: colored icon disc + tier name + the threshold that earned it.
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: spacing.md,
  },
  badgePressed: { opacity: 0.6 },
  badgeMedal: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTextWrap: {
    justifyContent: "center",
  },
  badgeLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
    lineHeight: T.size.sm * 1.25,
  },
  badgeReq: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
    lineHeight: T.size.xs * 1.25,
  },
  });
}

// ---------- Centered variant container (tighter than the shared one) ----------
// Own-profile gets less bottom padding since the user already knows what
// their profile says — no need to give it a stage.
function makeCenteredContainer(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.xl,
    // Clear gap before the content-tab strip so the stats never crowd it.
    paddingBottom: spacing.lg,
  },
  });
}

// ---------- Centered variant styles ----------

function makeCenteredStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  avatarWrap: {
    alignSelf: "center",
    marginTop: 0,
    marginBottom: spacing.md,
    position: "relative",
    ...shadows.md,
  },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.cardBackground,
    ...shadows.sm,
  },
  displayName: {
    // Stepped down from xxl → xl: still authoritative, less imposing
    fontFamily: fonts.black,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    textAlign: "center",
    letterSpacing: T.tracking.tight,
  },
  username: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 2,
  },
  bio: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    textAlign: "center",
    lineHeight: 21,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bioPlaceholder: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.sm,
  },
  });
}

// ---------- Default variant styles ----------

function makeDefaultStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingTop: spacing.lg,
  },
  // Right-hand action cluster: ⋯ menu + Follow/Blocked/Edit
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  editButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.cardBackground,
  },
  editButtonText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  followButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  followButtonText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.onPrimary,
  },
  followingButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.cardBackground,
    borderWidth: 1.5,
    borderColor: colors.primary,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  followingButtonText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  // Muted state pill shown in place of Follow when this user is blocked.
  blockedPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  blockedPillText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  pressed: { opacity: 0.7 },
  displayName: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    marginBottom: 2,
  },
  username: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  bio: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  });
}

// ---------- Action-sheet styles ----------

function makeSheetStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  // Sheet chrome (backdrop, rounded sheet, drag handle) now lives in
  // DraggableSheet; only the inner content styles remain here.
  title: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  actionText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  actionTextDestructive: {
    color: colors.error,
  },
  cancelText: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textSecondary,
  },
  });
}
