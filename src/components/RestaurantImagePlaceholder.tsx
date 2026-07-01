// src/components/RestaurantImagePlaceholder.tsx
// Monogram tile shown when a restaurant has no photo (common for bulk-imported
// spots). Fills its parent (absolute), so drop it behind an <Image> in a card:
// the image fades in over it when present, and photo-less cards get a tasteful,
// per-restaurant colored initial instead of an identical fork-knife.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { fonts } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import {
  restaurantInitial,
  restaurantPlaceholderColors,
} from "@/utils/restaurantPlaceholder";

interface RestaurantImagePlaceholderProps {
  /** Restaurant name — drives both the initial and the (stable) tile color. */
  name: string;
  /** Monogram size. Default 64 (the 200px-tall list cards). */
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function RestaurantImagePlaceholder({
  name,
  fontSize = 64,
  style,
}: RestaurantImagePlaceholderProps) {
  const { isDark } = useTheme();
  const { bg, fg } = restaurantPlaceholderColors(name, isDark);

  return (
    <View style={[styles.fill, { backgroundColor: bg }, style]}>
      <Text style={[styles.initial, { color: fg, fontSize }]} allowFontScaling={false}>
        {restaurantInitial(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    fontFamily: fonts.black,
  },
});
