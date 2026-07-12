// src/components/auth/StepDots.tsx
// Minimal progress indicator for the signup wizard — `total` segmented bars,
// filled ink through the current step.

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
            styles.bar,
            {
              backgroundColor: i <= index ? colors.primary : colors.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  bar: { width: 26, height: 4, borderRadius: radius.pill, marginHorizontal: 3 },
});
