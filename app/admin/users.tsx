// app/admin/users.tsx
// Admin: browse/search users, view profiles, ban/unban.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { Avatar } from "@/components/Avatar";
import { listUsers, searchUsers, setUserBanned } from "@/services/users";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { User } from "@/types/user";

export default function AdminUsers() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<User[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocusTick((t) => t + 1);
    }, []),
  );

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (query.trim()) {
          const users = await searchUsers(query);
          if (active) {
            setItems(users);
            setHasMore(false);
            setCursor(null);
          }
        } else {
          const page = await listUsers();
          if (active) {
            setItems(page.items);
            setCursor(page.nextCursor);
            setHasMore(page.hasMore);
          }
        }
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, focusTick]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || query.trim()) return;
    setLoadingMore(true);
    try {
      const page = await listUsers({ cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // keep what we have
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, query, cursor]);

  const toggleBan = useCallback((user: User) => {
    const next = !user.isBanned;
    Alert.alert(
      next ? `Ban @${user.username}?` : `Unban @${user.username}?`,
      next
        ? "They'll be flagged as banned."
        : "This removes the banned flag.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: next ? "Ban" : "Unban",
          style: next ? "destructive" : "default",
          onPress: async () => {
            try {
              await setUserBanned(user.id, next);
              setItems((prev) =>
                prev.map((u) =>
                  u.id === user.id ? { ...u, isBanned: next } : u,
                ),
              );
            } catch (err) {
              Alert.alert(
                "Couldn't update",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Users" />
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons
            name="magnify"
            size={18}
            color={colors.textSecondary}
          />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or @username…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <MaterialCommunityIcons
                name="close-circle"
                size={16}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => router.push(`/profile/${item.id}`)}
              accessibilityRole="button"
            >
              <Avatar
                fileId={item.avatarUrl}
                displayName={item.displayName}
                userId={item.id}
                size={44}
              />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.handle} numberOfLines={1}>
                  @{item.username}
                </Text>
              </View>
              {item.isBanned ? (
                <View style={styles.bannedBadge}>
                  <Text style={styles.bannedText}>Banned</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => toggleBan(item)}
                hitSlop={8}
                style={styles.menuBtn}
                accessibilityRole="button"
                accessibilityLabel="User options"
              >
                <MaterialCommunityIcons
                  name="dots-vertical"
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No users found.</Text>
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
  safe: { flex: 1, backgroundColor: colors.cardBackground },
  searchWrap: {
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    padding: 0,
  },
  listContent: { paddingBottom: 100 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.cardBackground,
  },
  pressed: { backgroundColor: colors.pageBackground },
  rowText: { flex: 1 },
  name: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  handle: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  bannedBadge: {
    backgroundColor: colors.errorBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  bannedText: { fontFamily: fonts.bold, fontSize: 10, color: colors.error },
  menuBtn: { padding: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: spacing.screen + 44 + spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.huge,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
  },
  footer: { paddingVertical: spacing.lg, alignItems: "center" },
  });
}
