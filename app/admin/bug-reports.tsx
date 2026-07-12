// app/admin/bug-reports.tsx
// Admin: user-submitted bug reports & suggestions. Mark resolved / reopen, or
// delete. Each card shows the type, message, reporter, and the auto-captured
// device/app info so you can reproduce.

import { Bug, Check } from "lucide-react-native";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import {
  deleteBugReport,
  listBugReports,
  updateBugReportStatus,
  type BugReport,
} from "@/services/bugReports";
import { getUsersByIds } from "@/services/users";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { User } from "@/types/user";

const TYPE_LABEL: Record<BugReport["type"], string> = {
  bug: "Bug",
  suggestion: "Suggestion",
  other: "Other",
};

export default function AdminBugReports() {
  const { styles, colors } = useThemedStyles(makeStyles);
  const [items, setItems] = useState<BugReport[]>([]);
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: reports } = await listBugReports();
      setItems(reports);
      const ids = Array.from(new Set(reports.map((r) => r.userId)));
      if (ids.length > 0) {
        const map = await getUsersByIds(ids).catch(
          () => new Map<string, User>(),
        );
        setUsers(map);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggleStatus = useCallback(async (report: BugReport) => {
    const next = report.status === "open" ? "resolved" : "open";
    setBusyId(report.id);
    setItems((prev) =>
      prev.map((r) => (r.id === report.id ? { ...r, status: next } : r)),
    );
    try {
      await updateBugReportStatus(report.id, next);
    } catch (err) {
      setItems((prev) =>
        prev.map((r) =>
          r.id === report.id ? { ...r, status: report.status } : r,
        ),
      );
      Alert.alert(
        "Couldn't update",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const remove = useCallback((report: BugReport) => {
    Alert.alert("Delete this report?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusyId(report.id);
          try {
            await deleteBugReport(report.id);
            setItems((prev) => prev.filter((r) => r.id !== report.id));
          } catch (err) {
            Alert.alert(
              "Couldn't delete",
              err instanceof Error ? err.message : "Try again.",
            );
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Bug reports" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => {
            const reporter = users.get(item.userId);
            const busy = busyId === item.id;
            const resolved = item.status === "resolved";
            return (
              <View style={[styles.card, resolved && styles.cardResolved]}>
                <View style={styles.cardHeader}>
                  <View style={styles.typePill}>
                    <Text style={styles.typeText}>{TYPE_LABEL[item.type]}</Text>
                  </View>
                  {resolved ? (
                    <View style={styles.resolvedPill}>
                      <Check size={12} strokeWidth={2.5} color={colors.success} />
                      <Text style={styles.resolvedText}>Resolved</Text>
                    </View>
                  ) : null}
                  <Text style={styles.date}>
                    {new Date(item.createdAt).toLocaleDateString()}
                  </Text>
                </View>

                <Text style={styles.message}>{item.message}</Text>

                <Text style={styles.meta} numberOfLines={2}>
                  {reporter ? `@${reporter.username} · ` : ""}
                  {item.deviceInfo || "—"}
                </Text>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => toggleStatus(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.statusBtn]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.statusText}>
                      {resolved ? "Reopen" : "Mark resolved"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => remove(item)}
                    disabled={busy}
                    style={[styles.actionBtn, styles.deleteBtn]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIconWrap}>
                <Bug size={30} strokeWidth={1.8} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No bug reports</Text>
              <Text style={styles.emptyBody}>
                Reports submitted from Settings will show up here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.pageBackground },
    listContent: {
      padding: spacing.screen,
      paddingBottom: 100,
      gap: spacing.md,
    },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardResolved: { opacity: 0.6 },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    typePill: {
      backgroundColor: colors.primaryLight,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.full,
    },
    typeText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.primary,
    },
    resolvedPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    resolvedText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.success,
    },
    date: {
      marginLeft: "auto",
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
    },
    message: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    meta: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
    },
    actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    actionBtn: {
      flex: 1,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    statusBtn: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statusText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textPrimary,
    },
    deleteBtn: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    deleteText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.error,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.huge,
      paddingHorizontal: spacing.xxxl,
      gap: spacing.sm,
    },
    emptyIconWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    emptyTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
      color: colors.textPrimary,
    },
    emptyBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
    },
  });
}
