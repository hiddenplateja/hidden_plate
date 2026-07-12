// src/components/CategoryChips.tsx
// Horizontal row of food-category chips — a round image tile with the label
// beneath it. Shared by the home feed (app/(tabs)/index.tsx) and the Saved tab
// so both stay visually identical. Each category maps to a custom full-colour
// PNG via CATEGORY_ICONS, falling back to a Lucide icon when a PNG isn't
// registered.

import { Image } from "expo-image";
import {
  CakeSlice,
  Fish,
  Flame,
  Leaf,
  Sandwich,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react-native";
import type { ReactNode } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { CATEGORY_ICONS } from "@/constants/categoryIcons";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export const CATEGORIES = [
  { id: "all", label: "All", icon: UtensilsCrossed },
  { id: "jerk", label: "Jerk", icon: Flame },
  { id: "seafood", label: "Seafood", icon: Fish },
  { id: "patties", label: "Patties", icon: Sandwich },
  { id: "ital", label: "Ital", icon: Leaf },
  { id: "sweets", label: "Sweets", icon: CakeSlice },
] as const;

// Two size presets. "default" = home/Saved; "compact" = the See-all pages,
// where the chip row sits under a search bar and should read a touch smaller.
const SIZES = {
  default: { chip: 68, tile: 60, tileH: 56, image: 44, glyph: 32 },
  compact: { chip: 56, tile: 48, tileH: 46, image: 34, glyph: 24 },
} as const;

// A single vertical chip: a round image (or glyph) tile with a label beneath.
// Reused for the categories and for the Saved tab's City filter (icon, no image).
export function TileChip({
  label,
  image,
  icon: Icon = UtensilsCrossed,
  active,
  onPress,
  compact = false,
}: {
  label: string;
  /** require()'d PNG (a module id / number). Takes precedence over `icon`. */
  image?: number;
  /** Icon fallback, or the icon for non-category chips (e.g. the City filter). */
  icon?: LucideIcon;
  active: boolean;
  onPress: () => void;
  /** Smaller variant for the See-all pages. */
  compact?: boolean;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const s = compact ? SIZES.compact : SIZES.default;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { width: s.chip }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <View style={[styles.tile, { width: s.tile, height: s.tileH }]}>
        {image != null ? (
          <Image
            source={image}
            style={{ width: s.image, height: s.image }}
            contentFit="contain"
          />
        ) : (
          <Icon
            size={s.glyph - 4}
            color={active ? colors.primary : colors.textMuted}
            strokeWidth={active ? 2.2 : 2}
          />
        )}
      </View>
      <Text
        style={[styles.label, active && styles.labelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CategoryChips({
  activeId,
  onSelect,
  trailing,
  contentContainerStyle,
  compact = false,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  /** Optional chip(s) rendered after the categories (e.g. a City filter). */
  trailing?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Smaller chips for the See-all pages. */
  compact?: boolean;
}) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <FlatList
      horizontal
      data={CATEGORIES}
      keyExtractor={(c) => c.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      ListFooterComponent={trailing ? <View>{trailing}</View> : null}
      renderItem={({ item }) => (
        <TileChip
          label={item.label}
          image={CATEGORY_ICONS[item.id]}
          icon={item.icon}
          active={activeId === item.id}
          onPress={() => onSelect(item.id)}
          compact={compact}
        />
      )}
    />
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    content: { gap: spacing.sm, paddingBottom: spacing.xs },
    // Vertical category item — icon on top, label beneath. Width + icon size are
    // applied inline so the chip can scale between default and compact.
    chip: { alignItems: "center" },
    // No circular chrome — just the icon on its own. Active state reads from the
    // icon tint (glyphs) and the emphasized label below.
    tile: {
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      fontFamily: fonts.medium,
      fontSize: T.size.xs,
      color: colors.textMuted,
      marginTop: spacing.xs,
      textAlign: "center",
    },
    labelActive: { fontFamily: fonts.bold, color: colors.primary },
  });
}
