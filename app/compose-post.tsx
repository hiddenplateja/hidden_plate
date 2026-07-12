// app/compose-post.tsx
// X-style composer for community posts. Opened from the Community tab's
// floating compose button. Text (required, 500 chars) + up to 4 photos.
//
// Photos are uploaded at submit time (compress → upload, with cleanup of
// already-uploaded files if a later one fails), then the post doc is created.
// On success we simply pop back — the Community screen re-fetches posts on
// focus, so the new post appears at the top of the feed.

import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import {
  ImagePickerField,
  type PickedPhoto,
} from "@/components/ImagePickerField";
import { useAuth } from "@/hooks/useAuth";
import {
  createPost,
  POST_MAX_IMAGES,
  POST_MAX_LENGTH,
} from "@/services/posts";
import {
  compressImage,
  deleteImage,
  uploadPostImage,
} from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function ComposePostScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const remaining = POST_MAX_LENGTH - text.length;
  const overLimit = remaining < 0;
  const canPost = text.trim().length > 0 && !overLimit && !submitting;

  const handleClose = () => {
    if (text.trim().length > 0 || photos.length > 0) {
      Alert.alert("Discard post?", "Your draft won't be saved.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ]);
      return;
    }
    router.back();
  };

  const handleSubmit = async () => {
    if (!canPost) return;
    setSubmitting(true);

    const uploadedIds: string[] = [];
    try {
      // Upload photos first — if one fails partway, delete what already went
      // up so we don't strand orphan files in the bucket.
      try {
        for (const photo of photos) {
          const compressed = await compressImage(photo.uri);
          const id = await uploadPostImage(compressed);
          uploadedIds.push(id);
        }
      } catch (err) {
        await Promise.all(uploadedIds.map((id) => deleteImage(id)));
        throw err;
      }

      await createPost({ text, imageIds: uploadedIds });
      router.back();
    } catch (err) {
      Alert.alert(
        "Couldn't post",
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header: close (left) · Post (right) */}
      <View style={styles.header}>
        <Pressable
          onPress={handleClose}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <X size={20} color={colors.textPrimary} strokeWidth={2.2} />
        </Pressable>

        <Pressable
          onPress={handleSubmit}
          disabled={!canPost}
          style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Publish post"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.postBtnText}>Post</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <View style={styles.composeRow}>
          <Avatar
            fileId={user?.avatarUrl}
            displayName={user?.displayName ?? ""}
            userId={user?.id ?? ""}
            size={42}
          />
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="What's cooking?"
            placeholderTextColor={colors.textMuted}
            multiline
            autoFocus
            maxLength={POST_MAX_LENGTH + 50} // soft cap; hard stop just past it
            editable={!submitting}
          />
        </View>

        <ImagePickerField
          photos={photos}
          onChange={setPhotos}
          max={POST_MAX_IMAGES}
          disabled={submitting}
        />

        <View style={styles.footerRow}>
          <Text style={[styles.counter, overLimit && styles.counterOver]}>
            {remaining}
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.sm,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    postBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      height: 36,
      minWidth: 72,
      alignItems: "center",
      justifyContent: "center",
    },
    postBtnDisabled: { opacity: 0.4 },
    postBtnText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.white,
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing.screen,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
    composeRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    input: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: T.size.lg,
      color: colors.textPrimary,
      lineHeight: 24,
      minHeight: 120,
      textAlignVertical: "top",
      paddingTop: spacing.sm,
    },
    footerRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: spacing.md,
    },
    counter: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
    counterOver: { color: colors.error },
  });
}
