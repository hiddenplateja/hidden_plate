// src/components/HomeFilterSheet.tsx
// Bottom-sheet filter panel for the home feed, plus the filter model and the
// pure helpers that apply it.
//
// Filters:
//   - Minimum rating (Any / 3.5+ / 4.0+ / 4.5+)
//   - Price range ($ / $$ / $$$ / $$$$, multi-select)
//   - Sort by (Recommended / Top rated / Newest)
//   - Verified only (toggle)
//
// The sheet edits a local DRAFT and only commits on "Apply", so the live result
// count on the button reflects the draft before the user confirms.

import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { DraggableSheet } from "@/components/DraggableSheet";
import {
  fonts,
  radius,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { PriceRange, Restaurant } from "@/types/restaurant";
import { isOpenNow } from "@/utils/openStatus";

export type HomeSort = "recommended" | "rating" | "newest" | "nearest";

export interface HomeFilters {
  minRating: number; // 0 = any
  priceRanges: PriceRange[];
  sort: HomeSort;
  verifiedOnly: boolean;
  openNow: boolean;
}

export const DEFAULT_FILTERS: HomeFilters = {
  minRating: 0,
  priceRanges: [],
  sort: "recommended",
  verifiedOnly: false,
  openNow: false,
};

const RATING_OPTIONS: { label: string; value: number }[] = [
  { label: "Any", value: 0 },
  { label: "3.5+", value: 3.5 },
  { label: "4.0+", value: 4.0 },
  { label: "4.5+", value: 4.5 },
];
const PRICE_OPTIONS: PriceRange[] = ["$", "$$", "$$$", "$$$$"];
const SORT_OPTIONS: { label: string; value: HomeSort }[] = [
  { label: "Recommended", value: "recommended" },
  { label: "Top rated", value: "rating" },
  { label: "Newest", value: "newest" },
  { label: "Nearest", value: "nearest" }, // only shown when location is available
];

/** Number of filters away from default — drives the button badge. */
export function countActiveFilters(f: HomeFilters): number {
  let n = 0;
  if (f.minRating > 0) n++;
  if (f.priceRanges.length > 0) n++;
  if (f.sort !== "recommended") n++;
  if (f.verifiedOnly) n++;
  if (f.openNow) n++;
  return n;
}

/**
 * Pure: apply the filters (and sort) to a list of restaurants. Pass
 * `distanceById` (km per restaurant id) to enable the "Nearest" sort.
 */
export function applyHomeFilters(
  list: Restaurant[],
  f: HomeFilters,
  distanceById?: Map<string, number>,
): Restaurant[] {
  let out = list;
  if (f.minRating > 0) out = out.filter((r) => r.averageRating >= f.minRating);
  if (f.priceRanges.length > 0) {
    out = out.filter(
      (r) => r.priceRange != null && f.priceRanges.includes(r.priceRange),
    );
  }
  if (f.verifiedOnly) out = out.filter((r) => r.isVerified);
  if (f.openNow) out = out.filter((r) => isOpenNow(r.openingHours));

  if (f.sort === "rating") {
    out = [...out].sort((a, b) => b.averageRating - a.averageRating);
  } else if (f.sort === "newest") {
    out = [...out].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } else if (f.sort === "nearest" && distanceById && distanceById.size > 0) {
    out = [...out].sort(
      (a, b) =>
        (distanceById.get(a.id) ?? Infinity) -
        (distanceById.get(b.id) ?? Infinity),
    );
  }
  return out;
}

// ── Sheet ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  initial: HomeFilters;
  /** Category/search-filtered base, used to show the live result count. */
  baseList: Restaurant[];
  /** Whether the "Nearest" sort option should be offered. */
  hasLocation: boolean;
  onApply: (filters: HomeFilters) => void;
  onClose: () => void;
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { styles: chip } = useThemedStyles(makeChipStyles);
  return (
    <Pressable
      onPress={onPress}
      style={[chip.base, active && chip.active]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[chip.label, active && chip.labelActive]}>{label}</Text>
    </Pressable>
  );
}

export function HomeFilterSheet({
  visible,
  initial,
  baseList,
  hasLocation,
  onApply,
  onClose,
}: Props) {
  const { styles: s, colors } = useThemedStyles(makeSheetStyles);
  const [draft, setDraft] = useState<HomeFilters>(initial);

  // Reset the draft to the committed filters each time the sheet opens.
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const count = applyHomeFilters(baseList, draft).length;
  const activeCount = countActiveFilters(draft);

  // "Nearest" only makes sense with a location fix.
  const sortOptions = hasLocation
    ? SORT_OPTIONS
    : SORT_OPTIONS.filter((o) => o.value !== "nearest");

  const togglePrice = (p: PriceRange) =>
    setDraft((d) => ({
      ...d,
      priceRanges: d.priceRanges.includes(p)
        ? d.priceRanges.filter((x) => x !== p)
        : [...d.priceRanges, p],
    }));

  return (
    <DraggableSheet visible={visible} onClose={onClose}>
      <View style={s.titleRow}>
        <Text style={s.title}>Filters</Text>
        {activeCount > 0 ? (
          <Pressable onPress={() => onApply(DEFAULT_FILTERS)} hitSlop={8}>
            <Text style={s.reset}>Reset</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.sectionLabel}>Minimum rating</Text>
            <View style={s.row}>
              {RATING_OPTIONS.map((o) => (
                <FilterChip
                  key={o.label}
                  label={o.label}
                  active={draft.minRating === o.value}
                  onPress={() => setDraft((d) => ({ ...d, minRating: o.value }))}
                />
              ))}
            </View>

            <Text style={s.sectionLabel}>Price</Text>
            <View style={s.row}>
              {PRICE_OPTIONS.map((p) => (
                <FilterChip
                  key={p}
                  label={p}
                  active={draft.priceRanges.includes(p)}
                  onPress={() => togglePrice(p)}
                />
              ))}
            </View>

            <Text style={s.sectionLabel}>Sort by</Text>
            <View style={s.row}>
              {sortOptions.map((o) => (
                <FilterChip
                  key={o.value}
                  label={o.label}
                  active={draft.sort === o.value}
                  onPress={() => setDraft((d) => ({ ...d, sort: o.value }))}
                />
              ))}
            </View>

            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>Open now</Text>
                <Text style={s.toggleSub}>
                  Only show places open right now
                </Text>
              </View>
              <Switch
                value={draft.openNow}
                onValueChange={(v) => setDraft((d) => ({ ...d, openNow: v }))}
                trackColor={{ false: colors.divider, true: colors.switchTrack }}
                thumbColor={colors.white}
              />
            </View>

            <View style={s.toggleRowStacked}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>Verified only</Text>
                <Text style={s.toggleSub}>
                  Show only spots we&apos;ve verified
                </Text>
              </View>
              <Switch
                value={draft.verifiedOnly}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, verifiedOnly: v }))
                }
                trackColor={{ false: colors.divider, true: colors.switchTrack }}
                thumbColor={colors.white}
              />
            </View>
          </ScrollView>

          <Pressable
            style={s.applyBtn}
            onPress={() => onApply(draft)}
            accessibilityRole="button"
          >
            <Text style={s.applyText}>
              {count === 0
                ? "No matches"
                : `Show ${count} ${count === 1 ? "place" : "places"}`}
            </Text>
          </Pressable>
    </DraggableSheet>
  );
}

function makeSheetStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
  },
  reset: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: T.tracking.wider,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  toggleRowStacked: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  toggleTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  toggleSub: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  applyBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  applyText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.onPrimary,
  },
  });
}

function makeChipStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  base: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  active: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  labelActive: {
    fontFamily: fonts.bold,
    color: colors.onPrimary,
  },
  });
}
