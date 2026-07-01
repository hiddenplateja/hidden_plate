// src/components/Skeleton.tsx
// Skeleton loading primitive — a grey rounded box with a sweeping gradient
// highlight that slides across, used as a placeholder while real content
// loads.
//
// Why this exists:
//   ActivityIndicator tells users "something is happening" but says nothing
//   about *what* is loading. Skeletons preserve the layout, so the transition
//   to real content is jitter-free and feels faster (perceived performance).
//
// Animation:
//   One Reanimated shared value per instance, driving a horizontal
//   translate of a LinearGradient overlay. The animation runs on the UI
//   thread, so N parallel skeletons in a list don't stack JS work.
//
// Typical usage:
//   <Skeleton width={120} height={20} borderRadius={4} />
//   <Skeleton width="100%" height={200} borderRadius={radius.xl} />
//
// Helper components:
//   <SkeletonText lines={3} /> — convenience for stacked text lines, last
//                                line shorter (typical placeholder pattern)
//   <SkeletonCircle size={48} /> — convenience for circular shapes (avatars)

import { LinearGradient } from "expo-linear-gradient";
import { memo, useEffect } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/theme/ThemeProvider";

const SWEEP_DURATION_MS = 1200;
// Highlight color for the sweep — slightly lighter than the base so the
// shimmer is visible against pageBackground. On light surfaces a near-white
// wash reads well; on dark surfaces it has to be very faint or it glares.
const SWEEP_LIGHT = "rgba(255, 255, 255, 0.7)";
const SWEEP_DARK = "rgba(255, 255, 255, 0.07)";

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  /** Override the default base color (colors.pageBackground). */
  backgroundColor?: string;
  /** Extra style for the outer container — useful for margin / alignment. */
  style?: object;
}

export const Skeleton = memo(function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 6,
  backgroundColor,
  style,
}: SkeletonProps) {
  const { colors, isDark } = useTheme();
  const baseColor = backgroundColor ?? colors.pageBackground;
  const sweep = isDark ? SWEEP_DARK : SWEEP_LIGHT;

  // Progress goes 0 → 1, then loops. The gradient overlay's translateX
  // is interpolated to go from off-left to off-right of the container.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: SWEEP_DURATION_MS,
        easing: Easing.linear,
      }),
      -1, // infinite
      false, // don't reverse — sweeps always go left → right
    );
  }, [progress]);

  const sweepStyle = useAnimatedStyle(() => ({
    // Translate the gradient across the box. The overlay is 200% wide
    // (2x the container) so we go from -100% (fully off-left) to
    // +100% (fully off-right). At 0.5 the highlight is centered.
    transform: [
      {
        translateX: `${interpolate(progress.value, [0, 1], [-100, 100])}%`,
      },
    ],
  }));

  return (
    <View
      style={[
        styles.container,
        { width, height, borderRadius, backgroundColor: baseColor },
        style,
      ]}
    >
      <Animated.View style={[styles.sweepWrap, sweepStyle]}>
        <LinearGradient
          colors={["transparent", sweep, "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
});

// ── Convenience helpers ──────────────────────────────────────────────────────

interface SkeletonTextProps {
  /** Number of stacked text lines */
  lines?: number;
  /** Height of each line (default: 14) */
  lineHeight?: number;
  /** Vertical gap between lines (default: 8) */
  gap?: number;
  /** Width of the last line as a percentage (default: 60). Mimics the way
   *  the final line of a paragraph is usually shorter than the rest. */
  lastLineWidthPct?: number;
}

export const SkeletonText = memo(function SkeletonText({
  lines = 2,
  lineHeight = 14,
  gap = 8,
  lastLineWidthPct = 60,
}: SkeletonTextProps) {
  return (
    <View style={{ gap }}>
      {Array.from({ length: lines }).map((_, i) => {
        const isLast = i === lines - 1 && lines > 1;
        return (
          <Skeleton
            key={i}
            width={isLast ? (`${lastLineWidthPct}%` as DimensionValue) : "100%"}
            height={lineHeight}
            borderRadius={4}
          />
        );
      })}
    </View>
  );
});

interface SkeletonCircleProps {
  size: number;
  style?: object;
}

export const SkeletonCircle = memo(function SkeletonCircle({
  size,
  style,
}: SkeletonCircleProps) {
  return (
    <Skeleton
      width={size}
      height={size}
      borderRadius={size / 2}
      style={style}
    />
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  // The sweep overlay is 2x the container width so it can fully cross
  // from off-screen-left to off-screen-right.
  sweepWrap: {
    ...StyleSheet.absoluteFillObject,
    width: "200%",
    left: "-50%",
  },
});
