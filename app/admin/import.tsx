// app/admin/import.tsx
// Admin: bulk-import seed restaurants by pasting a JSON array. Each row is
// published + verified immediately (curated content). Rows without lat/lng are
// geocoded from the address. Built for cold-start seeding of empty parishes.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { Button } from "@/components/ui/Button";
import {
  bulkImportRestaurants,
  type BulkImportResult,
  type BulkImportRow,
} from "@/services/restaurants";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const EXAMPLE = `[
  {
    "name": "Scotchies",
    "address": "Falmouth Main Rd",
    "parish": "trelawny",
    "city": "Falmouth",
    "cuisines": ["jamaican"],
    "categories": ["jerk", "bbq"],
    "priceRange": "$$",
    "phoneNumber": "876-000-0000",
    "latitude": 18.49,
    "longitude": -77.65
  },
  {
    "name": "Example Ital Stop",
    "address": "10 Main Street",
    "parish": "st_ann",
    "cuisines": ["vegan"],
    "categories": ["ital"]
  }
]`;

export default function AdminImport() {
  const { styles, colors } = useThemedStyles(makeStyles);
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const runImport = useCallback(
    async (rows: BulkImportRow[]) => {
      setImporting(true);
      setResult(null);
      try {
        const res = await bulkImportRestaurants(rows);
        setResult(res);
      } catch (err) {
        Alert.alert(
          "Import failed",
          err instanceof Error ? err.message : "Try again.",
        );
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  const handleImport = useCallback(() => {
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      Alert.alert("Invalid JSON", "Couldn't parse the text. Check for a stray comma or quote.");
      return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      Alert.alert("Expected a list", "Paste a JSON array of restaurants ( [ … ] ).");
      return;
    }
    Alert.alert(
      "Import restaurants?",
      `Create ${rows.length} ${rows.length === 1 ? "restaurant" : "restaurants"}? They'll be published and verified immediately.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Import", onPress: () => runImport(rows as BulkImportRow[]) },
      ],
    );
  }, [text, runImport]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AdminHeader title="Bulk import" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.blurb}>
          Paste a JSON array of restaurants to seed the catalogue. Each becomes a
          published, verified listing. Skip <Text style={styles.code}>latitude</Text>/
          <Text style={styles.code}>longitude</Text> and we&apos;ll geocode from the
          address — but coordinates are more reliable.
        </Text>

        <View style={styles.fieldHeader}>
          <Text style={styles.label}>Restaurants JSON</Text>
          <Pressable
            onPress={() => setText(EXAMPLE)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.loadExample}>Load example</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={EXAMPLE}
          placeholderTextColor={colors.textMuted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!importing}
        />

        <Text style={styles.help}>
          Required per row: <Text style={styles.code}>name</Text>,{" "}
          <Text style={styles.code}>address</Text>,{" "}
          <Text style={styles.code}>parish</Text>, and at least one{" "}
          <Text style={styles.code}>cuisines</Text> or{" "}
          <Text style={styles.code}>categories</Text>. Parish uses the underscore
          form, e.g. <Text style={styles.code}>st_andrew</Text>.
        </Text>

        <View style={styles.submitWrap}>
          <Button
            label={importing ? "Importing…" : "Import restaurants"}
            onPress={handleImport}
            disabled={importing || text.trim().length === 0}
            loading={importing}
          />
        </View>

        {result ? (
          <View style={styles.resultCard}>
            <View style={styles.resultRow}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.resultText}>
                {result.created} created
              </Text>
              {result.failed > 0 ? (
                <>
                  <Text style={styles.resultDot}>·</Text>
                  <MaterialCommunityIcons
                    name="alert-circle-outline"
                    size={18}
                    color={colors.error}
                  />
                  <Text style={[styles.resultText, { color: colors.error }]}>
                    {result.failed} failed
                  </Text>
                </>
              ) : null}
            </View>
            {result.errors.length > 0 ? (
              <View style={styles.errorList}>
                {result.errors.map((e, i) => (
                  <Text key={i} style={styles.errorLine}>
                    • {e}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {importing ? (
          <View style={styles.importingNote}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.importingText}>
              Importing — geocoding can take a moment per row.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.pageBackground },
    content: { padding: spacing.screen, paddingBottom: spacing.xxxl },
    blurb: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    fieldHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    label: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: T.tracking.wider,
    },
    loadExample: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    input: {
      minHeight: 220,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
      fontSize: T.size.sm,
      color: colors.textPrimary,
      backgroundColor: colors.cardBackground,
      textAlignVertical: "top",
    },
    help: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      lineHeight: 17,
      marginTop: spacing.sm,
    },
    code: {
      fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
      color: colors.textSecondary,
    },
    submitWrap: { marginTop: spacing.lg },
    resultCard: {
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.cardBackground,
      borderWidth: 1,
      borderColor: colors.divider,
      gap: spacing.sm,
    },
    resultRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    resultText: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    resultDot: { color: colors.textMuted, marginHorizontal: 2 },
    errorList: {
      gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      paddingTop: spacing.sm,
    },
    errorLine: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    importingNote: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    importingText: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
  });
}
