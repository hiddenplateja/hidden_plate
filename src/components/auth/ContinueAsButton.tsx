// src/components/auth/ContinueAsButton.tsx
// Returning-OAuth-user shortcut shown on the login screen: a "Continue as
// <name>" card with the provider photo. Tap it to re-authenticate with that
// provider; swipe it horizontally to forget the saved identity (onDismiss).

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { GoogleLogo } from "@/components/icons/GoogleLogo";
import type { LastOAuth } from "@/services/lastOAuth";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const SCREEN_W = Dimensions.get("window").width;
// Past this drag distance (or a fast fling), the card flies off and is removed.
const DISMISS_THRESHOLD = 96;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface ContinueAsButtonProps {
  identity: LastOAuth;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Fired once the card is swiped away — clear the saved identity. */
  onDismiss: () => void;
}

export function ContinueAsButton({
  identity,
  loading = false,
  disabled = false,
  onPress,
  onDismiss,
}: ContinueAsButtonProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const tx = useSharedValue(0);

  const pan = Gesture.Pan()
    // Only take over for clearly-horizontal drags; let vertical scrolls pass.
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onChange((e) => {
      tx.value = e.translationX;
    })
    .onEnd((e) => {
      const fling =
        Math.abs(e.translationX) > DISMISS_THRESHOLD ||
        Math.abs(e.velocityX) > 700;
      if (fling) {
        const dir = e.translationX < 0 ? -1 : 1;
        tx.value = withTiming(dir * SCREEN_W, { duration: 180 }, (done) => {
          if (done) runOnJS(onDismiss)();
        });
      } else {
        tx.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    opacity: 1 - Math.min(Math.abs(tx.value) / SCREEN_W, 1),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animStyle}>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Continue as ${identity.name}. Swipe to remove.`}
        >
          {identity.photoUrl ? (
            <Image
              source={{ uri: identity.photoUrl }}
              style={styles.avatar}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.initials}>{initials(identity.name)}</Text>
            </View>
          )}
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              Continue as {firstName(identity.name)}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {identity.email}
            </Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : identity.provider === "google" ? (
            <GoogleLogo size={18} />
          ) : (
            <MaterialCommunityIcons
              name="apple"
              size={18}
              color={colors.textPrimary}
            />
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardBackground,
      marginBottom: spacing.md,
      ...shadows.sm,
    },
    pressed: { opacity: 0.7 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.pageBackground,
    },
    avatarFallback: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    initials: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textInverse,
    },
    text: { flex: 1 },
    title: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    email: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginTop: 1,
    },
  });
}
