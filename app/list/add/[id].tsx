import { Image } from "expo-image";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, Circle, Search, UtensilsCrossed, X } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { addCollectionSelections, loadCollectionSuggestions, searchCollectionRestaurants } from "@/services/collectionPicker";
import { getList } from "@/services/lists";
import { getImagePreviewUrl } from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";
import type { Restaurant } from "@/types/restaurant";
import { COLLECTION_PICKER_PAGE_SIZE } from "@/utils/collectionSuggestions";
import { getCuisineLine, getLocationLine } from "@/utils/restaurantDisplay";

type Choice = { restaurant: Restaurant; reason: string };
type Results = { items: Choice[]; hasMore: boolean; nextCursor: string | null };

async function permittedLocation() {
  try {
    if ((await Location.getForegroundPermissionsAsync()).status !== "granted") return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60 * 60 * 1000 });
    return last ? { latitude: last.coords.latitude, longitude: last.coords.longitude } : null;
  } catch { return null; }
}

const RestaurantChoice = memo(function RestaurantChoice({ item, selected, disabled, onToggle }: {
  item: Choice; selected: boolean; disabled: boolean; onToggle: (id: string) => void;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const restaurant = item.restaurant;
  const photo = restaurant.coverImageId ?? restaurant.imageIds[0];
  return <Pressable onPress={() => onToggle(restaurant.id)} disabled={disabled}
    accessibilityRole="checkbox" accessibilityLabel={`${restaurant.name}. ${item.reason}`}
    accessibilityState={{ checked: selected, disabled }}
    style={({ pressed }) => [styles.row, selected && styles.selectedRow, pressed && styles.pressed]}>
    {photo ? <Image source={{ uri: getImagePreviewUrl(photo) }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
      : <View style={[styles.thumb, styles.placeholder]}><UtensilsCrossed size={22} color={colors.textMuted} /></View>}
    <View style={styles.rowInfo}>
      <Text style={styles.name} numberOfLines={2}>{restaurant.name}</Text>
      <Text style={styles.meta} numberOfLines={2}>{[getCuisineLine(restaurant), getLocationLine(restaurant)].filter(Boolean).join(" · ")}</Text>
      {item.reason ? <Text style={styles.reason}>{item.reason}</Text> : null}
    </View>
    {selected ? <View style={styles.checked}><Check size={18} color={colors.onPrimary} /></View>
      : <Circle size={24} color={colors.textMuted} />}
  </Pressable>;
});

export default function AddRestaurantsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  // Account switches must discard all private suggestions and selections.
  return <CollectionPicker key={`${user?.id ?? "signed-out"}:${id}`} id={id} userId={user?.id ?? null} />;
}

function CollectionPicker({ id, userId }: { id: string; userId: string | null }) {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [list, setList] = useState<List | null>(null);
  const [suggestions, setSuggestions] = useState<Choice[]>([]);
  const [limited, setLimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ items: [], hasMore: false, nextCursor: null });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(COLLECTION_PICKER_PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false), pagingRef = useRef(false), requestId = useRef(0), alive = useRef(true);
  const term = query.trim();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    if (!userId) { setError("Sign in to add restaurants to your collection."); setLoading(false); return; }
    (async () => {
      const [collection, location] = await Promise.all([getList(id), permittedLocation()]);
      if (collection.ownerId !== userId) throw new Error("Only the owner can add restaurants to this collection.");
      const data = await loadCollectionSuggestions(userId, collection.restaurantIds, location);
      if (active) { setList(collection); setSuggestions(data.items); setLimited(data.limitedPersonalization); }
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : "Couldn't load restaurants. Please retry."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, userId, retry]);

  useEffect(() => {
    const ticket = ++requestId.current;
    let active = true;
    pagingRef.current = false;
    setSearchError(null); setResults({ items: [], hasMore: false, nextCursor: null });
    if (!term || !list) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      searchCollectionRestaurants(term, list.restaurantIds).then(page => {
        if (active && ticket === requestId.current && alive.current) setResults({ ...page, items: page.items.map(restaurant => ({ restaurant, reason: "" })) });
      }).catch(e => {
        if (active && ticket === requestId.current && alive.current) setSearchError(e instanceof Error ? e.message : "Couldn't search. Please retry.");
      }).finally(() => { if (active && ticket === requestId.current && alive.current) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [term, list, searchRetry]);

  const toggle = useCallback((restaurantId: string) => {
    if (savingRef.current) return;
    setSelected(previous => { const next = new Set(previous); if (next.has(restaurantId)) next.delete(restaurantId); else next.add(restaurantId); return next; });
  }, []);
  const loadMore = useCallback(async () => {
    if (!term) { setVisibleCount(n => n + COLLECTION_PICKER_PAGE_SIZE); return; }
    if (!list || !results.hasMore || searching || pagingRef.current) return;
    pagingRef.current = true; setSearching(true); setSearchError(null);
    const ticket = requestId.current;
    try {
      const page = await searchCollectionRestaurants(term, list.restaurantIds, results.nextCursor);
      if (alive.current && ticket === requestId.current) setResults(previous => ({ ...page,
        items: [...previous.items, ...page.items.filter(restaurant => !previous.items.some(item => item.restaurant.id === restaurant.id)).map(restaurant => ({ restaurant, reason: "" }))] }));
    } catch (e) { if (alive.current && ticket === requestId.current) setSearchError(e instanceof Error ? e.message : "Couldn't load more. Please retry."); }
    finally { if (alive.current && ticket === requestId.current) { pagingRef.current = false; setSearching(false); } }
  }, [term, list, results.hasMore, results.nextCursor, searching]);

  const save = useCallback(async () => {
    if (!userId || !list || !selected.size || savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const result = await addCollectionSelections(id, userId, [...selected]);
      if (!alive.current) return;
      if (!result.failedIds.length) { router.back(); return; }
      const added = new Set(result.addedIds);
      setList(previous => previous ? { ...previous, restaurantIds: [...new Set([...previous.restaurantIds, ...result.addedIds])] } : previous);
      setSuggestions(previous => previous.filter(item => !added.has(item.restaurant.id)));
      setSelected(new Set(result.failedIds));
      Alert.alert("Some restaurants weren't added", `${result.addedIds.length} added. ${result.failedIds.length} still selected. Tap Add selected to retry.`);
    } catch (e) { if (alive.current) Alert.alert("Couldn't add restaurants", e instanceof Error ? e.message : "Please try again."); }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  }, [userId, list, selected, id, router]);

  const rows = useMemo(() => term ? results.items : suggestions.slice(0, visibleCount), [term, results.items, suggestions, visibleCount]);
  const hasMore = term ? results.hasMore : visibleCount < suggestions.length;
  const renderItem = useCallback(({ item }: { item: Choice }) => <RestaurantChoice item={item} selected={selected.has(item.restaurant.id)} disabled={saving} onToggle={toggle} />, [selected, saving, toggle]);

  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} disabled={saving} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back" accessibilityState={{ disabled: saving }}><ArrowLeft size={22} color={colors.textPrimary} /></Pressable>
        <Text style={styles.title}>Add restaurants</Text><View style={styles.iconButton} />
      </View>
      {list ? <Text style={styles.subtitle} numberOfLines={2}>{list.title}</Text> : null}
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.meta}>Finding restaurants for you…</Text></View>
        : error ? <View style={styles.center}><Text style={styles.error} accessibilityRole="alert">{error}</Text><Pressable style={styles.secondaryButton} onPress={() => setRetry(n => n + 1)}><Text style={styles.reason}>Retry</Text></Pressable></View>
        : <>
          <Text style={styles.searchLabel}>Search all restaurants</Text>
          <View style={styles.searchBox}><Search size={19} color={colors.textMuted} />
            <TextInput value={query} onChangeText={setQuery} editable={!saving} style={styles.searchInput} placeholder="Name, cuisine or location" placeholderTextColor={colors.textMuted} accessibilityLabel="Search all restaurants" autoCorrect={false} returnKeyType="search" />
            {query ? <Pressable onPress={() => setQuery("")} disabled={saving} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Clear search"><X size={18} color={colors.textMuted} /></Pressable> : null}
          </View>
          <Text style={styles.sectionTitle}>{term ? "Search results" : "Suggested for you"}</Text>
          {!term && limited ? <Text style={styles.notice}>Some activity couldn&apos;t load. You can still search all restaurants.</Text> : null}
          <FlatList data={rows} keyExtractor={item => item.restaurant.id} renderItem={renderItem} extraData={selected}
            style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent}
            ListEmptyComponent={searching ? null : <Text style={styles.empty}>{term ? "No matching restaurants. Try a different name, cuisine or location." : "No more suggestions. Search for a restaurant to add."}</Text>}
            ListFooterComponent={<View style={styles.listFooter}>
              {searching ? <ActivityIndicator color={colors.primary} /> : null}
              {searchError ? <><Text style={styles.error} accessibilityRole="alert">{searchError}</Text><Pressable style={styles.secondaryButton} onPress={() => results.items.length ? loadMore() : setSearchRetry(n => n + 1)}><Text style={styles.reason}>Retry search</Text></Pressable></> : null}
              {hasMore && !searching && !searchError ? <Pressable onPress={loadMore} disabled={saving} style={styles.secondaryButton} accessibilityRole="button"><Text style={styles.reason}>Show 20 more</Text></Pressable> : null}
            </View>} />
          <View style={styles.footer}>
            <Text style={styles.meta} accessibilityLiveRegion="polite">{selected.size} selected</Text>
            <Pressable onPress={save} disabled={saving || !selected.size} accessibilityRole="button" accessibilityState={{ disabled: saving || !selected.size, busy: saving }} style={({ pressed }) => [styles.addButton, (saving || !selected.size) && styles.disabled, pressed && styles.pressed]}>
              {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.addText}>Add selected{selected.size ? ` (${selected.size})` : ""}</Text>}
            </Pressable>
          </View>
        </>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground }, flex: { flex: 1 },
    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    title: { flex: 1, textAlign: "center", fontFamily: fonts.bold, fontSize: T.size.lg, color: colors.textPrimary },
    subtitle: { marginHorizontal: spacing.screen, marginBottom: spacing.md, fontFamily: fonts.medium, fontSize: T.size.base, color: colors.textSecondary },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
    searchLabel: { marginHorizontal: spacing.screen, fontFamily: fonts.medium, fontSize: T.size.sm, color: colors.textSecondary, marginBottom: spacing.xs },
    searchBox: { marginHorizontal: spacing.screen, flexDirection: "row", alignItems: "center", paddingLeft: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
    searchInput: { flex: 1, minHeight: 48, fontFamily: fonts.regular, fontSize: T.size.base, color: colors.textPrimary, paddingVertical: spacing.sm },
    sectionTitle: { marginHorizontal: spacing.screen, marginTop: spacing.lg, marginBottom: spacing.sm, fontFamily: fonts.bold, fontSize: T.size.base, color: colors.textPrimary },
    notice: { marginHorizontal: spacing.screen, marginBottom: spacing.sm, fontFamily: fonts.regular, fontSize: T.size.sm, color: colors.textSecondary },
    listContent: { paddingBottom: spacing.md }, listFooter: { padding: spacing.lg, gap: spacing.md },
    row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.screen, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    selectedRow: { backgroundColor: colors.surface }, pressed: { opacity: 0.7 },
    thumb: { width: 56, height: 56, borderRadius: radius.md }, placeholder: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
    rowInfo: { flex: 1, gap: spacing.xs }, name: { fontFamily: fonts.bold, fontSize: T.size.base, color: colors.textPrimary },
    meta: { fontFamily: fonts.regular, fontSize: T.size.sm, color: colors.textSecondary },
    reason: { fontFamily: fonts.medium, fontSize: T.size.sm, color: colors.primary },
    checked: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
    empty: { padding: spacing.xl, textAlign: "center", fontFamily: fonts.regular, fontSize: T.size.base, color: colors.textSecondary },
    error: { fontFamily: fonts.regular, fontSize: T.size.base, color: colors.error, textAlign: "center" },
    secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", padding: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface },
    footer: { paddingHorizontal: spacing.screen, paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    addButton: { minHeight: 48, alignItems: "center", justifyContent: "center", padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primary },
    addText: { fontFamily: fonts.bold, fontSize: T.size.base, color: colors.onPrimary }, disabled: { opacity: 0.5 },
  });
}
