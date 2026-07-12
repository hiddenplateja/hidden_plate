// src/components/DraggableSheet.tsx
// A bottom-sheet Modal you can dismiss two ways: tap the dimmed backdrop, or
// grab the handle at the top and drag it down. Renders its children inside a
// rounded sheet pinned to the bottom of the screen.
//
// The drag lives on the handle "grabber" region only (not the whole sheet) so
// tapping options inside never fights the gesture. Taps on the sheet body are
// absorbed so they don't fall through to the backdrop.

import type { ReactNode } from "react";
import { useEffect } from "react";
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { radius, spacing } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SCREEN_H = Dimensions.get("window").height;
// Drag past this (or fling faster than this) and the sheet dismisses.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

interface DraggableSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function DraggableSheet({
  visible,
  onClose,
  children,
}: DraggableSheetProps) {
  const { styles } = useThemedStyles(makeStyles);
  const translateY = useSharedValue(0);

  // Reset the sheet position each time it opens.
  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  const dragToDismiss = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        translateY.value = withTiming(SCREEN_H, { duration: 200 }, (done) => {
          if (done) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <AnimatedPressable
            style={[styles.sheet, animStyle]}
            onPress={() => {}}
          >
            <GestureDetector gesture={dragToDismiss}>
              <View style={styles.grabber}>
                <View style={styles.handle} />
              </View>
            </GestureDetector>
            {children}
          </AnimatedPressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: c.cardBackground,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.screen,
      paddingTop: spacing.xs,
      paddingBottom: Platform.OS === "ios" ? spacing.huge : spacing.xl,
      // Cap the height so a tall body (e.g. a scrolling filter list) stays on
      // screen; short content still sizes to its content.
      maxHeight: "88%",
    },
    // Draggable grabber region — chunky hit area so the swipe is easy to catch.
    grabber: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      alignItems: "center",
    },
    handle: {
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: c.divider,
    },
  });
}
