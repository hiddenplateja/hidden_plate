// src/components/ListForm.tsx
// Create/edit form for a Collection — title, optional description, public
// toggle. Self-contained (own state + validation); the screen supplies
// onSubmit + the submitting flag and handles the service call + navigation.

import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export interface ListFormValues {
  title: string;
  description: string;
  isPublic: boolean;
}

interface ListFormProps {
  initial?: Partial<ListFormValues>;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (values: ListFormValues) => void;
}

export function ListForm({
  initial,
  submitLabel,
  submitting = false,
  onSubmit,
}: ListFormProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const t = title.trim();
    if (t.length < 2) {
      setError("Give your collection a name (2+ characters).");
      return;
    }
    onSubmit({ title: t, description: description.trim(), isPublic });
  };

  return (
    <View style={styles.wrap}>
      <Input
        label="Name"
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          if (error) setError(null);
        }}
        placeholder="e.g. Best jerk in Kingston"
        maxLength={120}
        autoFocus
        error={error}
        editable={!submitting}
      />

      <Input
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="What's this collection about?"
        maxLength={500}
        multiline
        editable={!submitting}
        style={styles.descInput}
      />

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Public</Text>
          <Text style={styles.toggleSub}>
            Anyone with the link can view it, and it shows on your profile.
          </Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          trackColor={{ false: colors.divider, true: colors.switchTrack }}
          thumbColor={colors.white}
          disabled={submitting}
        />
      </View>

      <Button
        label={submitLabel}
        onPress={handleSubmit}
        loading={submitting}
        style={styles.submit}
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    wrap: { width: "100%" },
    descInput: {
      height: 96,
      paddingTop: spacing.md,
      textAlignVertical: "top",
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
    },
    toggleTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.base,
      color: colors.textPrimary,
    },
    toggleSub: {
      fontFamily: fonts.regular,
      fontSize: T.size.xs,
      color: colors.textMuted,
      marginTop: 2,
      paddingRight: spacing.md,
      lineHeight: 16,
    },
    submit: { marginTop: spacing.sm },
  });
}
