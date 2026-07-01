// src/components/StarRating.tsx
// Two modes:
//   - Display: shows N filled stars out of 5
//   - Input: tap a star to set the rating (1-5)
//
// We use Unicode stars (★ ☆) — no icon library dependency. Looks good
// across iOS and Android. Color is configurable for use in different contexts.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

interface StarRatingProps {
  value: number; // 0-5, supports decimals (4.5)
  onChange?: (value: number) => void; // if provided, becomes interactive
  size?: number; // px
  color?: string;
  emptyColor?: string;
}

const TOTAL = 5;

export function StarRating({
  value,
  onChange,
  size = 18,
  color = "#F59E0B",
  emptyColor,
}: StarRatingProps) {
  const { colors } = useTheme();
  const empty = emptyColor ?? colors.border;
  const interactive = !!onChange;

  if (interactive) {
    return (
      <View
        style={styles.row}
        accessibilityRole="adjustable"
        accessibilityLabel={`Rating, ${value} out of ${TOTAL}`}
      >
        {Array.from({ length: TOTAL }, (_, i) => {
          const idx = i + 1;
          const filled = idx <= value;
          return (
            <Pressable
              key={idx}
              onPress={() => onChange(idx)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${idx} star${idx === 1 ? "" : "s"}`}
            >
              <Text
                style={{
                  fontSize: size,
                  color: filled ? color : empty,
                  marginRight: 4,
                }}
              >
                ★
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  // Display mode — supports half stars by truncating to integer for now.
  // (Half-star rendering needs an overlay trick that's not worth the
  // complexity at this stage. Show the rounded value.)
  const filled = Math.round(value);
  return (
    <View style={styles.row} accessibilityLabel={`Rated ${value} of ${TOTAL}`}>
      {Array.from({ length: TOTAL }, (_, i) => (
        <Text
          key={i}
          style={{
            fontSize: size,
            color: i < filled ? color : empty,
            marginRight: 2,
          }}
        >
          ★
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
});
