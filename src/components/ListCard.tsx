// src/components/ListCard.tsx
// Compact row for a user's Collection — thumbnail + title + count/visibility.
// The cover comes from the cover restaurant's image; the parent resolves and
// passes `coverImageId` (it already hydrates the restaurants for the screen).

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getImagePreviewUrl } from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";

interface ListCardProps {
  list: List;
  coverImageId?: string | null;
  onPress: (listId: string) => void;
}

export const ListCard = memo(function ListCard({
  list,
  coverImageId,
  onPress,
}: ListCardProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const handlePress = useCallback(() => onPress(list.id), [onPress, list.id]);
  const url = coverImageId ? getImagePreviewUrl(coverImageId) : null;
  const count = list.restaurantIds.length;

  return (
    <Pressable
      onPress={handlePress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`Open collection ${list.title}`}
    >
      <View style={styles.imageWrap}>
        {url ? (
          <Image
            source={{ uri: url }}
            style={styles.image}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <MaterialCommunityIcons
              name="format-list-bulleted"
              size={26}
              color={colors.border}
            />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {list.title}
        </Text>
        <View style={styles.metaRow}>
          <MaterialCommunityIcons
            name={list.isPublic ? "earth" : "lock"}
            size={12}
            color={colors.textMuted}
          />
          <Text style={styles.meta} numberOfLines={1}>
            {count} {count === 1 ? "spot" : "spots"} ·{" "}
            {list.isPublic ? "Public" : "Private"}
          </Text>
        </View>
      </View>

      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={colors.textMuted}
      />
    </Pressable>
  );
});

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.screen,
    },
    imageWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.md,
      overflow: "hidden",
      backgroundColor: colors.pageBackground,
    },
    image: { width: "100%", height: "100%" },
    placeholder: { alignItems: "center", justifyContent: "center" },
    info: { flex: 1, gap: 3 },
    title: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    meta: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      flexShrink: 1,
    },
  });
}
