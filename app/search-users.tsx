// app/search-users.tsx
// User search + suggestions screen.
//
// Behavior:
//   - Search box at top — debounced 300ms
//   - When query is empty (or under 2 chars): show "Suggested for you" — top
//     users by recent follow activity
//   - When query is active: show search results
//   - Tap a row → that user's profile
//   - Inline Follow / Following button per row
//   - Pull to refresh suggestions
//
// Search is fulltext, prefix-matching only. Limitations explained in
// services/users.ts:searchUsers.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { UserRow } from "@/components/UserRow";
import { useAuth } from "@/hooks/useAuth";
import {
    followUser,
    getFollowingSetForUsers,
    unfollowUser,
} from "@/services/follows";
import { getSuggestedUsers, searchUsers } from "@/services/users";
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

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

interface SuggestedState {
  users: User[];
  followingSet: Set<string>;
  loading: boolean;
}

interface SearchState {
  query: string;
  results: User[];
  followingSet: Set<string>;
  loading: boolean;
  hasSearched: boolean;
}

export default function SearchUsersScreen() {
  const router = useRouter();
  const { user: me } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [suggested, setSuggested] = useState<SuggestedState>({
    users: [],
    followingSet: new Set(),
    loading: true,
  });
  const [search, setSearch] = useState<SearchState>({
    query: "",
    results: [],
    followingSet: new Set(),
    loading: false,
    hasSearched: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  // Debounce timer for search queries
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Load suggested ----------

  const loadSuggested = useCallback(async () => {
    setSuggested((prev) => ({ ...prev, loading: true }));
    try {
      const users = await getSuggestedUsers(10);
      const followingSet = await getFollowingSetForUsers(
        users.map((u) => u.id),
      );
      setSuggested({
        users,
        followingSet,
        loading: false,
      });
    } catch (err) {
      console.warn("[search-users] loadSuggested failed:", err);
      setSuggested({ users: [], followingSet: new Set(), loading: false });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSuggested();
  }, [loadSuggested]);

  // ---------- Search ----------

  const runSearch = useCallback(async (query: string) => {
    setSearch((prev) => ({ ...prev, query, loading: true }));
    try {
      const results = await searchUsers(query);
      const followingSet = await getFollowingSetForUsers(
        results.map((u) => u.id),
      );
      setSearch({
        query,
        results,
        followingSet,
        loading: false,
        hasSearched: true,
      });
    } catch (err) {
      console.warn("[search-users] runSearch failed:", err);
      setSearch({
        query,
        results: [],
        followingSet: new Set(),
        loading: false,
        hasSearched: true,
      });
    }
  }, []);

  const handleQueryChange = useCallback(
    (text: string) => {
      // Update input immediately for responsive UI
      setSearch((prev) => ({ ...prev, query: text }));

      // Clear any pending search
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      const trimmed = text.trim();
      if (trimmed.length < MIN_SEARCH_LENGTH) {
        // Reset to "no results yet" state, don't query
        setSearch({
          query: text,
          results: [],
          followingSet: new Set(),
          loading: false,
          hasSearched: false,
        });
        return;
      }

      debounceRef.current = setTimeout(() => {
        runSearch(trimmed);
      }, DEBOUNCE_MS);
    },
    [runSearch],
  );

  const handleClear = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSearch({
      query: "",
      results: [],
      followingSet: new Set(),
      loading: false,
      hasSearched: false,
    });
  }, []);

  // ---------- Follow toggle (shared by suggested + search results) ----------

  const handleToggleFollow = useCallback(
    async (targetId: string) => {
      if (busyIds.has(targetId)) return;

      // Look at both possible result sets — find current follow state
      const inSuggested = suggested.users.find((u) => u.id === targetId);
      const inSearch = search.results.find((u) => u.id === targetId);
      const wasFollowing = inSuggested
        ? suggested.followingSet.has(targetId)
        : inSearch
          ? search.followingSet.has(targetId)
          : false;

      // Optimistic update for whichever lists this user appears in
      setBusyIds((p) => new Set(p).add(targetId));
      setSuggested((prev) => {
        if (!prev.users.find((u) => u.id === targetId)) return prev;
        const next = new Set(prev.followingSet);
        if (wasFollowing) next.delete(targetId);
        else next.add(targetId);
        return { ...prev, followingSet: next };
      });
      setSearch((prev) => {
        if (!prev.results.find((u) => u.id === targetId)) return prev;
        const next = new Set(prev.followingSet);
        if (wasFollowing) next.delete(targetId);
        else next.add(targetId);
        return { ...prev, followingSet: next };
      });

      try {
        if (wasFollowing) await unfollowUser(targetId);
        else await followUser(targetId);
      } catch (err) {
        // Revert both
        setSuggested((prev) => {
          if (!prev.users.find((u) => u.id === targetId)) return prev;
          const next = new Set(prev.followingSet);
          if (wasFollowing) next.add(targetId);
          else next.delete(targetId);
          return { ...prev, followingSet: next };
        });
        setSearch((prev) => {
          if (!prev.results.find((u) => u.id === targetId)) return prev;
          const next = new Set(prev.followingSet);
          if (wasFollowing) next.add(targetId);
          else next.delete(targetId);
          return { ...prev, followingSet: next };
        });
        Alert.alert(
          wasFollowing ? "Couldn't unfollow" : "Couldn't follow",
          err instanceof Error ? err.message : "Try again.",
        );
      } finally {
        setBusyIds((p) => {
          const n = new Set(p);
          n.delete(targetId);
          return n;
        });
      }
    },
    [busyIds, suggested, search],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadSuggested();
  }, [loadSuggested]);

  // Decide what to render based on state
  const isSearching = search.query.trim().length >= MIN_SEARCH_LENGTH;
  const showingSuggested = !isSearching;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
        <Text style={styles.headerTitle}>Find People</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Search bar */}
      <View style={styles.searchBarWrap}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={colors.textSecondary}
            style={{ marginRight: spacing.sm }}
          />
          <TextInput
            value={search.query}
            onChangeText={handleQueryChange}
            placeholder="Search by name or @username"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="never"
          />
          {search.query.length > 0 ? (
            <Pressable onPress={handleClear} hitSlop={8}>
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Body */}
      {showingSuggested ? (
        <FlatList
          data={suggested.users}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              isMe={me?.id === item.id}
              isFollowing={suggested.followingSet.has(item.id)}
              busy={busyIds.has(item.id)}
              onPress={() => router.push(`/profile/${item.id}`)}
              onToggleFollow={() => handleToggleFollow(item.id)}
            />
          )}
          ListHeaderComponent={
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Suggested for you</Text>
              <Text style={styles.sectionSubtitle}>
                Active members of the Hidden Plate community
              </Text>
            </View>
          }
          ListEmptyComponent={
            suggested.loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name="account-search-outline"
                    size={32}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>No suggestions yet</Text>
                <Text style={styles.emptyBody}>
                  The community is still growing. Search above to find specific
                  people.
                </Text>
              </View>
            )
          }
          ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        />
      ) : (
        <FlatList
          data={search.results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              isMe={me?.id === item.id}
              isFollowing={search.followingSet.has(item.id)}
              busy={busyIds.has(item.id)}
              onPress={() => router.push(`/profile/${item.id}`)}
              onToggleFollow={() => handleToggleFollow(item.id)}
            />
          )}
          ListEmptyComponent={
            search.loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.searchingText}>
                  Searching for &ldquo;{search.query.trim()}&rdquo;…
                </Text>
              </View>
            ) : search.hasSearched ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name="magnify-close"
                    size={32}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>No results</Text>
                <Text style={styles.emptyBody}>
                  We couldn&apos;t find anyone matching &ldquo;
                  {search.query.trim()}&rdquo;. Try a different spelling or just
                  the first few letters.
                </Text>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
  },
  searchBarWrap: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // Elevated white pill — matches the home (index) page search bar.
  searchBar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    padding: 0,
  },
  sectionHeader: {
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  sectionSubtitle: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.screen + 48 + spacing.md,
  },
  listContent: {
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  searchingText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  });
}
