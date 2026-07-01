// src/components/OwnerReviewResponse.tsx
// Renders the restaurant owner's public reply under a review, and — when the
// viewer IS the owner — lets them write / edit / delete it inline.
//
// Self-contained: fetches the owner reply on focus (scoped to ownerId so only
// the genuine owner's reply ever shows). Renders nothing for an unclaimed
// restaurant or a non-owner with no reply present.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createResponse,
  deleteResponse,
  getOwnerResponse,
  updateResponse,
  type ReviewResponse,
} from "@/services/reviewResponses";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

interface Props {
  reviewId: string;
  restaurantId: string;
  ownerId: string | null;
  currentUserId: string | null;
  /** Restaurant name, for the reply label. */
  restaurantName?: string;
}

export function OwnerReviewResponse({
  reviewId,
  restaurantId,
  ownerId,
  currentUserId,
  restaurantName,
}: Props) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const [response, setResponse] = useState<ReviewResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = !!currentUserId && currentUserId === ownerId;

  useFocusEffect(
    useCallback(() => {
      if (!ownerId) {
        setResponse(null);
        return;
      }
      let active = true;
      getOwnerResponse(reviewId, ownerId)
        .then((r) => {
          if (active) setResponse(r);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [reviewId, ownerId]),
  );

  const startEdit = useCallback(() => {
    setDraft(response?.text ?? "");
    setEditing(true);
  }, [response]);

  const handleSave = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const saved = response
        ? await updateResponse(response.id, body)
        : await createResponse({ reviewId, restaurantId, text: body });
      setResponse(saved);
      setEditing(false);
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [draft, response, reviewId, restaurantId]);

  const handleDelete = useCallback(() => {
    if (!response) return;
    Alert.alert("Delete your reply?", "This removes your public response.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await deleteResponse(response.id);
            setResponse(null);
            setEditing(false);
          } catch (err) {
            Alert.alert(
              "Couldn't delete",
              err instanceof Error ? err.message : "Try again.",
            );
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [response]);

  // Unclaimed restaurant → nothing to show or do.
  if (!ownerId) return null;

  // Owner composing / editing.
  if (editing) {
    return (
      <View style={styles.editor}>
        <Text style={styles.editorLabel}>
          {response ? "Edit your reply" : "Reply as the owner"}
        </Text>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Thanks for the feedback…"
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
          editable={!busy}
        />
        <View style={styles.editorActions}>
          <Pressable
            onPress={() => setEditing(false)}
            disabled={busy}
            style={styles.cancelBtn}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={busy || draft.trim().length === 0}
            style={[
              styles.saveBtn,
              (busy || draft.trim().length === 0) && styles.saveBtnDisabled,
            ]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.saveText}>
                {response ? "Save" : "Post reply"}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // A reply exists → show it (to everyone).
  if (response) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <MaterialCommunityIcons
            name="storefront"
            size={15}
            color={colors.primary}
          />
          <Text style={styles.label}>
            {restaurantName ? `Reply from ${restaurantName}` : "Owner reply"}
          </Text>
          <View style={styles.ownerBadge}>
            <Text style={styles.ownerBadgeText}>Owner</Text>
          </View>
        </View>
        <Text style={styles.body}>{response.text}</Text>
        {isOwner ? (
          <View style={styles.ownerActions}>
            <Pressable onPress={startEdit} hitSlop={6} disabled={busy}>
              <Text style={styles.actionText}>Edit</Text>
            </Pressable>
            <Pressable onPress={handleDelete} hitSlop={6} disabled={busy}>
              <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  // No reply yet → only the owner sees the compose affordance.
  if (isOwner) {
    return (
      <Pressable
        onPress={startEdit}
        style={({ pressed }) => [styles.replyCta, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Reply to this review as the owner"
      >
        <MaterialCommunityIcons
          name="reply-outline"
          size={18}
          color={colors.primary}
        />
        <Text style={styles.replyCtaText}>Reply as the owner</Text>
      </Pressable>
    );
  }

  return null;
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    card: {
      marginHorizontal: spacing.screen,
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.primaryLight,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: spacing.xs,
    },
    label: {
      flex: 1,
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    ownerBadge: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    ownerBadgeText: {
      fontFamily: fonts.bold,
      fontSize: T.size.xs,
      color: colors.textInverse,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textPrimary,
      lineHeight: 21,
    },
    ownerActions: {
      flexDirection: "row",
      gap: spacing.lg,
      marginTop: spacing.sm,
    },
    actionText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    deleteText: { color: colors.error },
    replyCta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.screen,
      marginTop: spacing.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: "dashed",
      backgroundColor: colors.cardBackground,
    },
    replyCtaText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
    pressed: { opacity: 0.7 },
    editor: {
      marginHorizontal: spacing.screen,
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    editorLabel: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    input: {
      minHeight: 80,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textPrimary,
      backgroundColor: colors.cardBackground,
      textAlignVertical: "top",
    },
    editorActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    cancelBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    cancelText: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    saveBtn: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      minWidth: 96,
      alignItems: "center",
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textInverse,
    },
  });
}
