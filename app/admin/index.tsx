// app/admin/index.tsx
// Admin dashboard: at-a-glance counts + links into each management section.

import {
  Bug,
  ChevronRight,
  Database,
  Download,
  FileWarning,
  Flag,
  Inbox,
  MessagesSquare,
  MessageSquareWarning,
  ShieldUser,
  Star,
  UserCheck,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { getAdminStats, type AdminStats } from "@/services/admin";
import { rebuildSearchText } from "@/services/restaurants";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface SectionDef {
  label: string;
  subtitle: string;
  icon: LucideIcon;
  route:
    | "/admin/restaurants"
    | "/admin/submissions"
    | "/admin/claims"
    | "/admin/owners"
    | "/admin/reviews"
    | "/admin/reports"
    | "/admin/comment-reports"
    | "/admin/post-reports"
    | "/admin/post-comment-reports"
    | "/admin/bug-reports"
    | "/admin/users"
    | "/admin/spotlight";
  badge?: (s: AdminStats) => number;
}

const SECTIONS: SectionDef[] = [
  {
    label: "Restaurants",
    subtitle: "Add, edit, verify, feature, delete",
    icon: UtensilsCrossed,
    route: "/admin/restaurants",
  },
  {
    label: "Submissions",
    subtitle: "Approve user-submitted restaurants",
    icon: Inbox,
    route: "/admin/submissions",
    badge: (s) => s.restaurantsPending,
  },
  {
    label: "Claims",
    subtitle: "Verify restaurant owners",
    icon: ShieldUser,
    route: "/admin/claims",
    badge: (s) => s.claims,
  },
  {
    label: "Owners",
    subtitle: "Users with claimed restaurants",
    icon: UserCheck,
    route: "/admin/owners",
  },
  {
    label: "Reviews & comments",
    subtitle: "Moderate and remove content",
    icon: MessagesSquare,
    route: "/admin/reviews",
  },
  {
    label: "Reports",
    subtitle: "Handle reported reviews",
    icon: Flag,
    route: "/admin/reports",
    badge: (s) => s.reports,
  },
  {
    label: "Comment reports",
    subtitle: "Handle reported comments",
    icon: MessageSquareWarning,
    route: "/admin/comment-reports",
    badge: (s) => s.commentReports,
  },
  {
    label: "Post reports",
    subtitle: "Handle reported community posts",
    icon: FileWarning,
    route: "/admin/post-reports",
    badge: (s) => s.postReports,
  },
  {
    label: "Post comment reports",
    subtitle: "Handle reported post comments",
    icon: MessageSquareWarning,
    route: "/admin/post-comment-reports",
    badge: (s) => s.postCommentReports,
  },
  {
    label: "Bug reports",
    subtitle: "User-reported bugs & suggestions",
    icon: Bug,
    route: "/admin/bug-reports",
  },
  {
    label: "Users",
    subtitle: "Browse, search, ban",
    icon: Users,
    route: "/admin/users",
  },
  {
    label: "Featured & Spotlight",
    subtitle: "Featured spots + Spot of the Day",
    icon: Star,
    route: "/admin/spotlight",
  },
];

export default function AdminDashboard() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuildSearch = useCallback(() => {
    Alert.alert(
      "Rebuild search index?",
      "Writes the search haystack on every restaurant so server-side search " +
        "can match them. Run this once after adding the searchText attribute " +
        "(safe to re-run anytime).",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rebuild",
          onPress: async () => {
            setRebuilding(true);
            try {
              const { scanned, updated } = await rebuildSearchText();
              Alert.alert(
                "Search index rebuilt",
                `Scanned ${scanned} restaurants, updated ${updated}.`,
              );
            } catch (err) {
              Alert.alert(
                "Rebuild failed",
                err instanceof Error ? err.message : "Try again.",
              );
            } finally {
              setRebuilding(false);
            }
          },
        },
      ],
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getAdminStats().then((s) => {
        if (active) setStats(s);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Admin" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Stat cards */}
        <View style={styles.statsRow}>
          <StatCard
            label="Pending"
            value={stats?.restaurantsPending}
            highlight
          />
          <StatCard label="Active spots" value={stats?.restaurantsActive} />
        </View>
        <View style={styles.statsRow}>
          <StatCard label="Reviews" value={stats?.reviews} />
          <StatCard label="Users" value={stats?.users} />
          <StatCard label="Reports" value={stats?.reports} />
        </View>

        {/* Sections */}
        <Text style={styles.sectionLabel}>Manage</Text>
        <View style={styles.sections}>
          {SECTIONS.map((s) => {
            const count = stats && s.badge ? s.badge(stats) : 0;
            return (
              <Pressable
                key={s.route}
                // Cast: the typed-routes union regenerates on dev-server
                // start; the freshly-added /admin/post-reports isn't in it yet.
                onPress={() => router.push(s.route as Href)}
                style={({ pressed }) => [
                  styles.sectionRow,
                  pressed && styles.sectionRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={s.label}
              >
                <View style={styles.sectionIcon}>
                  <s.icon size={20} color={colors.primary} strokeWidth={2} />
                </View>
                <View style={styles.sectionText}>
                  <Text style={styles.sectionTitle}>{s.label}</Text>
                  <Text style={styles.sectionSub} numberOfLines={1}>
                    {s.subtitle}
                  </Text>
                </View>
                {count > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{count}</Text>
                  </View>
                ) : null}
                <ChevronRight
                  size={18}
                  color={colors.textMuted}
                  strokeWidth={2}
                />
              </Pressable>
            );
          })}
        </View>

        {/* Maintenance */}
        <Text style={styles.sectionLabel}>Maintenance</Text>
        <View style={styles.sections}>
          <Pressable
            onPress={handleRebuildSearch}
            disabled={rebuilding}
            style={({ pressed }) => [
              styles.sectionRow,
              pressed && styles.sectionRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Rebuild search index"
          >
            <View style={styles.sectionIcon}>
              {rebuilding ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Database size={20} color={colors.primary} strokeWidth={2} />
              )}
            </View>
            <View style={styles.sectionText}>
              <Text style={styles.sectionTitle}>
                {rebuilding ? "Rebuilding…" : "Rebuild search index"}
              </Text>
              <Text style={styles.sectionSub} numberOfLines={1}>
                Refresh the server-search haystack on every restaurant
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/import")}
            style={({ pressed }) => [
              styles.sectionRow,
              pressed && styles.sectionRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Bulk import restaurants"
          >
            <View style={styles.sectionIcon}>
              <Download size={20} color={colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.sectionText}>
              <Text style={styles.sectionTitle}>Bulk import restaurants</Text>
              <Text style={styles.sectionSub} numberOfLines={1}>
                Seed the catalogue from a JSON list
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | undefined;
  highlight?: boolean;
}) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>
        {value ?? "—"}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  content: { padding: spacing.screen, paddingBottom: spacing.xxxl },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  statCardHighlight: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  statValue: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  statValueHighlight: { color: colors.primary },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sections: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: "hidden",
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  sectionRowPressed: { backgroundColor: colors.pageBackground },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionText: { flex: 1 },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  sectionSub: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.onPrimary,
  },
  });
}
