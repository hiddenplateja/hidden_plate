// src/components/PhotoViewer.tsx
// Fullscreen photo viewer with swipe + tap arrows.
//
// Open it by passing a non-null `index` (the photo to start on); pass null to
// close. When there's more than one photo it shows a "n / total" counter and
// left/right arrows (arrows hide at the ends). Swiping still works too.

import { Image } from "expo-image";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";

const { width: SW, height: SH } = Dimensions.get("window");

interface PhotoViewerProps {
  /** Fully-resolved image URIs to page through. */
  photos: string[];
  /** Index to open on. `null` keeps the viewer closed. */
  index: number | null;
  onClose: () => void;
}

export function PhotoViewer({ photos, index, onClose }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<string>>(null);
  const [current, setCurrent] = useState(index ?? 0);

  // Sync the tracked index to the photo we were opened on.
  useEffect(() => {
    if (index != null) setCurrent(index);
  }, [index]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(photos.length - 1, next));
      setCurrent(clamped);
      listRef.current?.scrollToIndex({ index: clamped, animated: true });
    },
    [photos.length],
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setCurrent(Math.round(e.nativeEvent.contentOffset.x / SW));
    },
    [],
  );

  const visible = index !== null && photos.length > 0;
  const multiple = photos.length > 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <FlatList
          // Re-key by the opening index so the list remounts (and honours
          // initialScrollIndex) each time the viewer opens — a Modal keeps its
          // children mounted, so initialScrollIndex alone would only apply the
          // first time. Closing always passes index through null ("pv-null"),
          // so reopening on any index (including the same one) remounts fresh.
          key={`pv-${index}`}
          ref={listRef}
          data={photos}
          keyExtractor={(uri, i) => `viewer-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index ?? 0}
          getItemLayout={(_, i) => ({ length: SW, offset: SW * i, index: i })}
          onMomentumScrollEnd={onMomentumEnd}
          renderItem={({ item: uri }) => (
            <View style={styles.page}>
              <Image
                source={{ uri }}
                style={styles.image}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={150}
              />
            </View>
          )}
        />

        {/* Top bar: counter (center) + close (right) */}
        <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
          {multiple ? (
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {current + 1} / {photos.length}
              </Text>
            </View>
          ) : null}
          <Pressable
            style={styles.iconBtn}
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X size={22} color="#FFFFFF" strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* Prev / next arrows — only when there's somewhere to go. */}
        {multiple && current > 0 ? (
          <Pressable
            style={[styles.arrow, styles.arrowLeft]}
            onPress={() => goTo(current - 1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous photo"
          >
            <ChevronLeft size={26} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        ) : null}
        {multiple && current < photos.length - 1 ? (
          <Pressable
            style={[styles.arrow, styles.arrowRight]}
            onPress={() => goTo(current + 1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next photo"
          >
            <ChevronRight size={26} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.97)" },
  page: { width: SW, height: SH, alignItems: "center", justifyContent: "center" },
  image: { width: SW, height: SH * 0.82 },
  topBar: {
    position: "absolute",
    left: spacing.screen,
    right: spacing.screen,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  counter: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  counterText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: "#FFFFFF",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: { left: spacing.md },
  arrowRight: { right: spacing.md },
});
