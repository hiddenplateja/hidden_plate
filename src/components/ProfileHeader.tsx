// src/components/ProfileHeader.tsx
// Top section of a profile screen.
//
// Two variants:
//   variant="centered" — your own profile tab. Centered avatar with an edit
//     pencil overlay, centered name/handle/bio, then a minimal stats row.
//     No follow button (it's your profile).
//   variant="default" — viewing another user. Left-aligned avatar with Follow
//     button on the right, then name/handle/bio, then the same stats row.
//
// Stats row design notes:
//   - No bordered card, no background fill — just open whitespace
//   - Big bold numbers, tiny grey labels beneath
//   - Vertical hairline dividers between stats (drawn 1px wide, short)
//   - Secondary line (★ avg · parishes) sits below in muted grey
//
// This style matches the rest of the white-blended UI on Community/Saved.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Avatar } from "@/components/Avatar";
import {
  colors,
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { User } from "@/types/user";

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
  onFollowersPress,
  onFollowingPress,
}: ProfileHeaderProps) {
  const [busy, setBusy] = useState(false);

  const handleFollowPress = useCallback(async () => {
    if (busy || !onToggleFollow) return;
    setBusy(true);
    try {
      await onToggleFollow();
    } finally {
      setBusy(false);
    }
  }, [busy, onToggleFollow]);

  if (variant === "centered") {
    return (
      <View style={styles.container}>
        {/* Centered avatar with edit pencil overlay */}
        <View style={centeredStyles.avatarWrap}>
          <Avatar
            fileId={user.avatarUrl}
            displayName={user.displayName}
            userId={user.id}
            size={96}
          />
          {isOwn && onEditPress ? (
            <Pressable
              style={centeredStyles.editBadge}
              onPress={onEditPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <MaterialCommunityIcons
                name="pencil"
                size={14}
                color={colors.textInverse}
              />
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

        {/* Edit Profile pill — only on own profile, in addition to the pencil */}
        {isOwn && onEditPress ? (
          <Pressable
            onPress={onEditPress}
            style={({ pressed }) => [
              centeredStyles.editPill,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
          >
            <Text style={centeredStyles.editPillText}>Edit Profile</Text>
          </Pressable>
        ) : null}

        <StatsRow
          stats={stats}
          follow={follow}
          onFollowersPress={onFollowersPress}
          onFollowingPress={onFollowingPress}
        />

        {stats.reviewCount > 0 ? <SecondaryLine stats={stats} /> : null}
      </View>
    );
  }

  // ---------- Default variant (viewing another user) ----------
  return (
    <View style={styles.container}>
      <View style={defaultStyles.avatarRow}>
        <Avatar
          fileId={user.avatarUrl}
          displayName={user.displayName}
          userId={user.id}
          size={88}
        />
        {!isOwn && onToggleFollow ? (
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
                color={follow.isFollowing ? colors.primary : colors.textInverse}
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
    </View>
  );
}

// ---------- Stats row (shared) ----------

interface StatsRowProps {
  stats: ProfileStats;
  follow: FollowState;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

function StatsRow({
  stats,
  follow,
  onFollowersPress,
  onFollowingPress,
}: StatsRowProps) {
  return (
    <View style={styles.statsRow}>
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
  return (
    <View style={styles.secondaryStats}>
      <MaterialCommunityIcons name="star" size={13} color={colors.star} />
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

interface StatBlockProps {
  label: string;
  value: string;
  onPress?: () => void;
}

function StatBlock({ label, value, onPress }: StatBlockProps) {
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

const styles = StyleSheet.create({
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
});

// ---------- Centered variant styles ----------

const centeredStyles = StyleSheet.create({
  avatarWrap: {
    alignSelf: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    position: "relative",
    ...shadows.md,
  },
  editBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.cardBackground,
    ...shadows.sm,
  },
  displayName: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    textAlign: "center",
    letterSpacing: T.tracking.tight,
  },
  username: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 2,
  },
  bio: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    textAlign: "center",
    lineHeight: 22,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bioPlaceholder: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.sm,
  },
  // Subtle pill button — outlined, sits centered below the bio
  editPill: {
    alignSelf: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 1,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.cardBackground,
  },
  editPillText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
});

// ---------- Default variant styles ----------

const defaultStyles = StyleSheet.create({
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingTop: spacing.lg,
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
    color: colors.textInverse,
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
