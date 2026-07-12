// src/components/PolicyScreen.tsx
// Reusable scaffold for content-only screens (Privacy, Terms, etc).
//
// Renders a sticky header with a back button + title, then a scrollable
// body of section blocks.
//
// Each section is rendered with a heading + body. The `placeholder` prop
// surfaces a top warning banner so it's obvious to anyone reviewing the
// app that the legal copy needs real lawyer-reviewed text before launch.

import { ArrowLeft, TriangleAlert } from "lucide-react-native";
import { useRouter } from "expo-router";
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export interface PolicySection {
  heading: string;
  body: string;
}

interface PolicyScreenProps {
  title: string;
  lastUpdated?: string;
  intro?: string;
  sections: PolicySection[];
  placeholder?: boolean;
  footer?: ReactNode;
}

export function PolicyScreen({
  title,
  lastUpdated,
  intro,
  sections,
  placeholder,
  footer,
}: PolicyScreenProps) {
  const router = useRouter();
  const { styles, colors } = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {placeholder ? (
          <View style={styles.placeholderBanner}>
            <TriangleAlert size={17} color={colors.warning} strokeWidth={2} />
            <Text style={styles.placeholderText}>
              Placeholder text. Replace with lawyer-reviewed content before
              launch.
            </Text>
          </View>
        ) : null}

        {lastUpdated ? (
          <Text style={styles.lastUpdated}>Last updated: {lastUpdated}</Text>
        ) : null}

        {intro ? <Text style={styles.intro}>{intro}</Text> : null}

        {sections.map((section, i) => (
          <View key={`section-${i}`} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}

        {footer ?? null}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pageBackground },
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
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.huge,
  },
  placeholderBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FEF3CD",
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  placeholderText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: "#7A4F00",
    lineHeight: 18,
  },
  lastUpdated: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontStyle: "italic",
  },
  intro: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  section: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: T.size.lg,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    marginBottom: spacing.sm,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  });
}
