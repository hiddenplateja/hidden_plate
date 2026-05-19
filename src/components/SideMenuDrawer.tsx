// src/components/SideMenuDrawer.tsx
// Right-side slide-in drawer menu.
// Used for the profile tab's hamburger menu.
//
// Usage:
//   <SideMenuDrawer
//     visible={isOpen}
//     onClose={() => setIsOpen(false)}
//     title="Menu"
//     items={[...]}
//     footer={...}
//   />

import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
    Modal,
    Pressable,
    SafeAreaView as RNSafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import {
    colors,
    fonts,
    radius,
    shadows,
    spacing,
    typographyTokens as T,
} from "@/theme/colors";

export interface SideMenuItem {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface SideMenuDrawerProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  items: SideMenuItem[];
  /** Item rendered at the bottom of the drawer (typically Sign out). */
  footer?: SideMenuItem;
}

export function SideMenuDrawer({
  visible,
  onClose,
  title = "Menu",
  items,
  footer,
}: SideMenuDrawerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Tap outside the drawer to close. The drawer itself stops propagation. */}
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <RNSafeAreaView style={{ flex: 1 }}>
            {/* Drawer header */}
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={colors.textPrimary}
                />
              </Pressable>
            </View>

            {/* Scrollable menu items */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.itemsContainer}
            >
              {items.map((item) => (
                <DrawerItem key={item.label} item={item} />
              ))}
            </ScrollView>

            {/* Footer item — locked to bottom of drawer */}
            {footer ? <DrawerItem item={footer} /> : null}
          </RNSafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DrawerItem({ item }: { item: SideMenuItem }) {
  return (
    <Pressable
      onPress={item.onPress}
      android_ripple={{ color: colors.pageBackground }}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <View style={[styles.iconWrap, item.danger && styles.iconWrapDanger]}>
        <MaterialCommunityIcons
          name={item.icon}
          size={22}
          color={item.danger ? colors.error : colors.textPrimary}
        />
      </View>
      <Text style={[styles.itemLabel, item.danger && styles.itemLabelDanger]}>
        {item.label}
      </Text>
      {!item.danger ? (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={colors.textMuted}
        />
      ) : null}
    </Pressable>
  );
}

// Re-export children of the drawer for callers that want to customize.
export const SideMenuDrawerContent: typeof DrawerItem = DrawerItem;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "78%",
    height: "100%",
    backgroundColor: colors.cardBackground,
    ...shadows.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: T.size.xl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  itemsContainer: {
    paddingBottom: spacing.xl,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  itemPressed: { backgroundColor: colors.pageBackground },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.pageBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDanger: {
    backgroundColor: colors.errorBg,
  },
  itemLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  itemLabelDanger: {
    color: colors.error,
    fontFamily: fonts.bold,
  },
});
