// src/components/MenuEditor.tsx
// Nested editor for a restaurant menu: a list of sections, each with a title
// and a list of dish names (names only — no prices/descriptions). Fully
// controlled: it holds no state itself; the parent owns the MenuSection[] and
// receives onChange. Used by RestaurantForm. Empty rows are harmless — the
// service cleans the menu (drops blank items/sections) on save.

import { CirclePlus, Plus, Trash2, X } from "lucide-react-native";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { MenuSection } from "@/types/restaurant";

interface MenuEditorProps {
  value: MenuSection[];
  onChange: (next: MenuSection[]) => void;
  disabled?: boolean;
}

export function MenuEditor({ value, onChange, disabled }: MenuEditorProps) {
  const { styles, colors } = useThemedStyles(makeStyles);

  const updateTitle = (si: number, title: string) =>
    onChange(value.map((s, i) => (i === si ? { ...s, title } : s)));

  const updateItem = (si: number, ii: number, name: string) =>
    onChange(
      value.map((s, i) =>
        i === si
          ? { ...s, items: s.items.map((it, j) => (j === ii ? name : it)) }
          : s,
      ),
    );

  const addSection = () => onChange([...value, { title: "", items: [""] }]);
  const removeSection = (si: number) =>
    onChange(value.filter((_, i) => i !== si));

  const addItem = (si: number) =>
    onChange(
      value.map((s, i) => (i === si ? { ...s, items: [...s.items, ""] } : s)),
    );
  const removeItem = (si: number, ii: number) =>
    onChange(
      value.map((s, i) =>
        i === si ? { ...s, items: s.items.filter((_, j) => j !== ii) } : s,
      ),
    );

  return (
    <View style={styles.wrap}>
      {value.map((section, si) => (
        <View key={si} style={styles.section}>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.sectionTitleInput]}
              value={section.title}
              onChangeText={(t) => updateTitle(si, t)}
              placeholder="Section (e.g. Mains)"
              placeholderTextColor={colors.textMuted}
              editable={!disabled}
              maxLength={60}
            />
            <Pressable
              onPress={() => removeSection(si)}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Remove section"
              disabled={disabled}
            >
              <Trash2 size={19} color={colors.error} strokeWidth={2} />
            </Pressable>
          </View>

          {section.items.map((item, ii) => (
            <View key={ii} style={styles.row}>
              <TextInput
                style={[styles.input, styles.itemNameInput]}
                value={item}
                onChangeText={(t) => updateItem(si, ii, t)}
                placeholder="Dish name"
                placeholderTextColor={colors.textMuted}
                editable={!disabled}
                maxLength={120}
              />
              <Pressable
                onPress={() => removeItem(si, ii)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Remove item"
                disabled={disabled}
              >
                <X size={17} color={colors.textMuted} strokeWidth={2} />
              </Pressable>
            </View>
          ))}

          <Pressable
            onPress={() => addItem(si)}
            style={styles.addItemBtn}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Plus size={15} color={colors.primary} strokeWidth={2.2} />
            <Text style={styles.addItemText}>Add item</Text>
          </Pressable>
        </View>
      ))}

      <Pressable
        onPress={addSection}
        style={styles.addSectionBtn}
        disabled={disabled}
        accessibilityRole="button"
      >
        <CirclePlus size={17} color={colors.primary} strokeWidth={2} />
        <Text style={styles.addSectionText}>
          {value.length === 0 ? "Add a menu section" : "Add another section"}
        </Text>
      </Pressable>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    wrap: { gap: spacing.md },
    // Matches RestaurantForm's `input` style so menu fields look native here.
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    section: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.pageBackground,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    sectionTitleInput: { flex: 1, fontFamily: fonts.bold },
    itemNameInput: { flex: 1 },
    iconBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    addItemBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: spacing.xs,
      alignSelf: "flex-start",
    },
    addItemText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    addSectionBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    addSectionText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.primary,
    },
  });
}
