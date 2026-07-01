// app/admin/spotlight.tsx
// Admin: pin the Spot of the Day (restaurant + optional date + optional plate
// image) and manage Featured restaurants.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import {
  ImagePickerField,
  type PickedPhoto,
} from "@/components/ImagePickerField";
import {
  getRestaurantById,
  listAdminRestaurants,
  listRestaurants,
  setRestaurantFlags,
} from "@/services/restaurants";
import {
  getSpotConfig,
  setSpotOfTheDay,
  type SpotConfig,
} from "@/services/spotOfTheDay";
import {
  compressImage,
  getImagePreviewUrl,
  uploadRestaurantImage,
} from "@/services/storage";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import { getLocationLine } from "@/utils/restaurantDisplay";
import { spotDayKey } from "@/utils/spotOfTheDay";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function AdminSpotlight() {
  const { styles, colors } = useThemedStyles(makeStyles);
  const [config, setConfig] = useState<SpotConfig | null>(null);
  const [pinned, setPinned] = useState<Restaurant | null>(null);
  const [featured, setFeatured] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  // Pin editor
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [pinDate, setPinDate] = useState("");
  const [platePhotos, setPlatePhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cfg, feat] = await Promise.all([
      getSpotConfig(),
      listRestaurants({ filters: { featured: true }, pageSize: 50 }).catch(
        () => ({ items: [] as Restaurant[] }),
      ),
    ]);
    setConfig(cfg);
    setFeatured(feat.items);
    if (cfg?.spotRestaurantId) {
      try {
        setPinned(await getRestaurantById(cfg.spotRestaurantId));
      } catch {
        setPinned(null);
      }
    } else {
      setPinned(null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Debounced restaurant search for the pin editor.
  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const page = await listAdminRestaurants({
          search: query,
          status: "active",
          pageSize: 8,
        });
        if (active) setResults(page.items);
      } catch {
        if (active) setResults([]);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, selected]);

  const resetEditor = () => {
    setSelected(null);
    setPinDate("");
    setPlatePhotos([]);
    setQuery("");
    setResults([]);
  };

  const pinSelected = useCallback(async () => {
    if (!selected) return;
    const date = pinDate.trim();
    if (date && !DATE_RE.test(date)) {
      Alert.alert(
        "Check the date",
        "Use YYYY-MM-DD, or leave it blank to pin until you change it.",
      );
      return;
    }
    setBusy(true);
    try {
      let plateId: string | null = null;
      const p = platePhotos[0];
      if (p) {
        if (p.existingFileId) {
          plateId = p.existingFileId;
        } else {
          setProgress("Uploading image…");
          const compressed = await compressImage(p.uri);
          plateId = await uploadRestaurantImage(compressed);
        }
      }
      await setSpotOfTheDay(selected.id, date || null, plateId);
      setPinned(selected);
      setConfig((prev) => ({
        id: prev?.id ?? null,
        spotRestaurantId: selected.id,
        spotDate: date || null,
        plateImage: plateId,
      }));
      resetEditor();
    } catch (err) {
      Alert.alert(
        "Couldn't pin",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [selected, pinDate, platePhotos]);

  const clearPin = useCallback(async () => {
    setBusy(true);
    try {
      await setSpotOfTheDay(null, null, null);
      setPinned(null);
      setConfig((prev) =>
        prev
          ? { ...prev, spotRestaurantId: null, spotDate: null, plateImage: null }
          : prev,
      );
    } catch (err) {
      Alert.alert(
        "Couldn't clear",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const unfeature = useCallback((r: Restaurant) => {
    Alert.alert(
      "Remove from featured?",
      `"${r.name}" will no longer be featured.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unfeature",
          style: "destructive",
          onPress: async () => {
            try {
              await setRestaurantFlags(r.id, { isFeatured: false });
              setFeatured((prev) => prev.filter((x) => x.id !== r.id));
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
      <AdminHeader title="Featured & Spotlight" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Spot of the Day */}
          <Text style={styles.sectionTitle}>Spot of the Day</Text>
          {config === null ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>
                Pinning needs the app_config collection. Set
                EXPO_PUBLIC_APPWRITE_APP_CONFIG_COLLECTION_ID to enable it.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.currentLabel}>Currently</Text>
              <Text style={styles.currentValue}>
                {pinned ? pinned.name : "Automatic daily pick (no pin)"}
              </Text>
              {pinned && config.spotDate ? (
                <Text style={styles.currentMeta}>Only on {config.spotDate}</Text>
              ) : pinned ? (
                <Text style={styles.currentMeta}>Pinned until changed</Text>
              ) : null}
              {pinned ? (
                <Pressable
                  onPress={clearPin}
                  disabled={busy}
                  style={styles.clearBtn}
                >
                  <Text style={styles.clearText}>Clear pin</Text>
                </Pressable>
              ) : null}

              {/* Pin editor */}
              {selected ? (
                <View style={styles.editor}>
                  <View style={styles.editorHead}>
                    <Text style={styles.editorName} numberOfLines={1}>
                      {selected.name}
                    </Text>
                    <Pressable onPress={resetEditor} hitSlop={8}>
                      <Text style={styles.changeLink}>Change</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.fieldLabel}>Date (optional)</Text>
                  <View style={styles.dateRow}>
                    <TextInput
                      style={styles.dateInput}
                      value={pinDate}
                      onChangeText={setPinDate}
                      placeholder="YYYY-MM-DD (blank = until changed)"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      maxLength={10}
                    />
                    <Pressable
                      onPress={() => setPinDate(spotDayKey())}
                      style={styles.todayBtn}
                    >
                      <Text style={styles.todayText}>Today</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.fieldLabel}>Plate image (optional)</Text>
                  <ImagePickerField
                    photos={platePhotos}
                    onChange={setPlatePhotos}
                    max={1}
                    disabled={busy}
                  />

                  {progress ? (
                    <Text style={styles.progress}>{progress}</Text>
                  ) : null}

                  <View style={styles.editorActions}>
                    <Pressable
                      onPress={resetEditor}
                      disabled={busy}
                      style={[styles.editorBtn, styles.cancelBtn]}
                    >
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={pinSelected}
                      disabled={busy}
                      style={[styles.editorBtn, styles.pinBtn]}
                    >
                      {busy ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.textInverse}
                        />
                      ) : (
                        <Text style={styles.pinText}>Pin spot</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
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
                      placeholder="Search a restaurant to pin…"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                    />
                  </View>
                  {results.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => {
                        setSelected(r);
                        setResults([]);
                      }}
                      style={({ pressed }) => [
                        styles.resultRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.resultName} numberOfLines={1}>
                        {r.name}
                      </Text>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={18}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          )}

          {/* Featured */}
          <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
            Featured restaurants
          </Text>
          {featured.length === 0 ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>
                None yet. Turn on “Featured” when editing a restaurant to add it
                here.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {featured.map((r) => {
                const coverId = r.coverImageId ?? r.imageIds[0] ?? null;
                const thumb = coverId ? getImagePreviewUrl(coverId) : null;
                const location = getLocationLine(r);
                return (
                  <View key={r.id} style={styles.featRow}>
                    {thumb ? (
                      <Image
                        source={{ uri: thumb }}
                        style={styles.thumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]}>
                        <MaterialCommunityIcons
                          name="silverware-fork-knife"
                          size={16}
                          color={colors.textMuted}
                        />
                      </View>
                    )}
                    <View style={styles.featText}>
                      <Text style={styles.featName} numberOfLines={1}>
                        {r.name}
                      </Text>
                      {location ? (
                        <Text style={styles.featSub} numberOfLines={1}>
                          {location}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => unfeature(r)}
                      hitSlop={8}
                      style={styles.unfeatureBtn}
                    >
                      <Text style={styles.unfeatureText}>Unfeature</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
  content: { padding: spacing.screen, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  note: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.md,
  },
  noteText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.md,
    gap: spacing.sm,
  },
  currentLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
  },
  currentValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  currentMeta: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  clearBtn: { alignSelf: "flex-start" },
  clearText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.error,
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
    marginTop: spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    padding: 0,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  pressed: { backgroundColor: colors.pageBackground },
  resultName: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },

  editor: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.xs,
  },
  editorHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editorName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  changeLink: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  dateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  todayBtn: {
    paddingHorizontal: spacing.md,
    height: 44,
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  todayText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  progress: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  editorActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  editorBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  pinBtn: { backgroundColor: colors.primary },
  pinText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textInverse,
  },

  list: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: "hidden",
  },
  featRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  featText: { flex: 1 },
  featName: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  featSub: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  unfeatureBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unfeatureText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textPrimary,
  },
  });
}
