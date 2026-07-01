// src/theme/useThemedStyles.ts
// Bridges the static-StyleSheet pattern to the theme. A screen defines a
// module-scope `makeStyles(c)` factory (same body as its old StyleSheet, just
// reading colors off `c`), then calls:
//
//   const { styles, colors } = useThemedStyles(makeStyles);
//
// `styles` are memoized per palette; `colors` is the active palette for inline
// color props. Re-runs only when the theme changes.

import { useMemo } from "react";

import { useTheme } from "@/theme/ThemeProvider";
import type { ThemeColors } from "@/theme/themes";

export function useThemedStyles<T extends object>(
  factory: (c: ThemeColors) => T,
): { styles: T; colors: ThemeColors } {
  const { colors } = useTheme();
  const styles = useMemo(() => factory(colors), [factory, colors]);
  return { styles, colors };
}
