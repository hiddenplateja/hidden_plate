// src/components/MenuSheet.tsx
// Bottom-sheet modal that displays a restaurant's menu — sections, each with
// its dish names. Opened from the restaurant detail screen's "View menu" button.

import { X } from "lucide-react-native";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { MenuSection } from "@/types/restaurant";

interface MenuSheetProps {
  visible: boolean;
  sections: MenuSection[];
  restaurantName?: string;
  onClose: () => void;
}

export function MenuSheet({
  visible,
  sections,
  restaurantName,
  onClose,
}: MenuSheetProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* Tap the area above the sheet to dismiss. */}
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text style={styles.title}>Menu</Text>
              {restaurantName ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {restaurantName}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            >
              <X size={21} color={colors.textPrimary} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {sections.map((section, si) => (
              <View key={si} style={styles.section}>
                {section.title ? (
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                ) : null}
                {section.items.map((item, ii) => (
                  <Text key={ii} style={styles.item}>
                    {item}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    backdropFill: { flex: 1 },
    sheet: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.md,
      paddingHorizontal: spacing.screen,
      paddingBottom: spacing.huge,
      maxHeight: "82%",
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      alignSelf: "center",
      marginBottom: spacing.md,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.md,
    },
    flex: { flex: 1 },
    title: {
      fontFamily: fonts.black,
      fontSize: T.size.xl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textMuted,
      marginTop: 2,
    },
    closeBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: spacing.md },
    section: { marginBottom: spacing.lg },
    sectionTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
      marginBottom: spacing.sm,
    },
    item: {
      fontFamily: fonts.medium,
      fontSize: T.size.base,
      color: colors.textPrimary,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
  });
}
