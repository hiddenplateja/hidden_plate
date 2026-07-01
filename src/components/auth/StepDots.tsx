// src/components/auth/StepDots.tsx
// Minimal progress indicator for the signup wizard — `total` dots with the
// current one elongated and coral.

import { StyleSheet, View } from "react-native";

import { radius } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";

interface StepDotsProps {
  total: number;
  index: number; // 0-based active step
}

export function StepDots({ total, index }: StepDotsProps) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.row}
      accessibilityLabel={`Step ${index + 1} of ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              width: i === index ? 22 : 8,
              backgroundColor: i === index ? colors.primary : colors.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dot: { height: 8, borderRadius: radius.pill, marginHorizontal: 3 },
});
