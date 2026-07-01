// app/report-bug.tsx
// "Report a bug" form. Reached from Settings. Lets a signed-in user pick a type
// (Bug / Suggestion / Other), describe the issue, and submit. Device + app
// info is captured automatically by the service, so the user doesn't type it.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import {
  submitBugReport,
  type BugReportType,
} from "@/services/bugReports";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const TYPES: { value: BugReportType; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { value: "bug", label: "Bug", icon: "bug-outline" },
  { value: "suggestion", label: "Suggestion", icon: "lightbulb-outline" },
  { value: "other", label: "Other", icon: "dots-horizontal" },
];

export default function ReportBugScreen() {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [type, setType] = useState<BugReportType>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!message.trim()) {
      Alert.alert("Add a description", "Tell us what went wrong or what you'd like to see.");
      return;
    }
    setSubmitting(true);
    try {
      await submitBugReport({ type, message });
      Alert.alert(
        "Thanks!",
        "Your report has been sent. We appreciate you helping make Hidden Plate better.",
        [{ text: "Done", onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert(
        "Couldn't send",
        err instanceof Error ? err.message : "Please try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>
          <Text style={styles.headerTitle}>Report a bug</Text>
          <View style={{ width: 36 }} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          <Text style={styles.intro}>
            Found something broken or have an idea? Let us know — your device and
            app version are attached automatically so we can look into it.
          </Text>

          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => {
              const active = type === t.value;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setType(t.value)}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <MaterialCommunityIcons
                    name={t.icon}
                    size={16}
                    color={active ? colors.primary : colors.textMuted}
                  />
                  <Text
                    style={[styles.typeText, active && styles.typeTextActive]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>What happened?</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={message}
            onChangeText={setMessage}
            placeholder="Describe the bug or suggestion. The more detail (and steps to reproduce) the better."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            editable={!submitting}
            maxLength={2000}
          />

          <Button
            label="Send report"
            onPress={handleSubmit}
            loading={submitting}
            style={styles.submit}
          />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.md,
      backgroundColor: colors.cardBackground,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    backBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
    content: { padding: spacing.lg, paddingBottom: spacing.huge },
    intro: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    label: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
      marginBottom: spacing.sm,
    },
    typeRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    typeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.pageBackground,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    typeChipActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    typeText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
    typeTextActive: { fontFamily: fonts.bold, color: colors.primary },
    input: {
      backgroundColor: colors.pageBackground,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    textArea: { minHeight: 140 },
    submit: { marginTop: spacing.xl },
  });
}
