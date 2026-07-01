// src/components/Avatar.tsx
// User avatar — either an uploaded image or a colored circle with initials.
//
// Used in:
//   - ProfileHeader (large)
//   - ReviewItem (small)
//   - UserReviewItem (small)
//   - Future: search results, mentions, etc.
//
// Falls back to a deterministic colored circle with initials when no avatar
// is uploaded. The color is derived from the user ID so it's consistent
// across renders (one user always has the same fallback color).

import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { getAvatarUrl } from "@/services/storage";
import { fonts } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface AvatarProps {
  fileId: string | null | undefined;
  displayName: string;
  userId: string;
  size?: number;
}

// Palette for the fallback circle. Deliberately muted — these are background
// colors, not brand accents. Hashing the userId picks one consistently.
const FALLBACK_COLORS = [
  "#E94B3C", // primary coral
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F97316", // orange
];

function hashToIndex(input: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  fileId,
  displayName,
  userId,
  size = 40,
}: AvatarProps) {
  const { styles } = useThemedStyles(makeStyles);
  const url = getAvatarUrl(fileId);
  const dimensionStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.image, dimensionStyle]}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
      />
    );
  }

  const color = FALLBACK_COLORS[hashToIndex(userId, FALLBACK_COLORS.length)];
  return (
    <View style={[styles.fallback, dimensionStyle, { backgroundColor: color }]}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>
        {initials(displayName)}
      </Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  image: {
    backgroundColor: colors.pageBackground,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontFamily: fonts.bold,
    color: colors.white,
    letterSpacing: -0.3,
  },
  });
}
