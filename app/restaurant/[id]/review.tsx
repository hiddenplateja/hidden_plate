// app/restaurant/[id]/review.tsx
// Write or edit a review with photo attachments.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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

import { BadgeEarnedModal } from "@/components/BadgeEarnedModal";
import {
    ImagePickerField,
    type PickedPhoto,
} from "@/components/ImagePickerField";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { syncEarnedBadges } from "@/services/badges";
import { getRestaurantById } from "@/services/restaurants";
import {
    createReview,
    getMyReviewForRestaurant,
    getUserReviewStats,
    updateReview,
} from "@/services/reviews";
import {
    compressImage,
    deleteImage,
    uploadReviewImage,
} from "@/services/storage";
import { radius, spacing, typography } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";
import type { ReviewerBadge } from "@/utils/reviewerBadges";

const MAX_COMMENT = 2000;
const MAX_PHOTOS = 6;

export default function WriteReviewScreen() {
  const params = useLocalSearchParams<{ id: string; reviewId?: string }>();
  const router = useRouter();
  const restaurantId = params.id;
  const editingReviewId = params.reviewId;
  const { user } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  // Badges newly crossed by this review → shows the celebration modal.
  const [celebration, setCelebration] = useState<ReviewerBadge[] | null>(null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // Track original imageIds so we can detect which were removed during edit
  const originalImageIdsRef = useRef<string[]>([]);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const commentRef = useRef<TextInput>(null);
  const { styles, colors } = useThemedStyles(makeStyles);

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await getRestaurantById(restaurantId);
        if (cancelled) return;
        setRestaurant(r);

        if (editingReviewId) {
          const existing = await getMyReviewForRestaurant(restaurantId);
          if (cancelled) return;
          if (existing) {
            setRating(existing.rating);
            setComment(existing.comment ?? "");
            // Existing photos are represented as PickedPhoto with existingFileId.
            // We use a special URI scheme — actual rendering happens via the
            // file ID lookup in ImagePickerField if we extend it; for now, the
            // local thumb won't render but we preserve the IDs.
            // Simpler: don't show existing photos as thumbs in edit mode for v1.
            // The user can re-add or remove.
            originalImageIdsRef.current = existing.imageIds;
            // For UX, show them — we use buildFileUrl to render
            const { getImageViewUrl } = await import("@/services/storage");
            setPhotos(
              existing.imageIds.map((fileId) => ({
                uri: getImageViewUrl(fileId),
                existingFileId: fileId,
              })),
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        Alert.alert(
          "Couldn't load",
          err instanceof Error ? err.message : "Try again.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, editingReviewId, router]);

  const handleSubmit = async () => {
    if (rating < 1) {
      setRatingError("Please tap to add a rating.");
      return;
    }
    setRatingError(null);
    setSubmitting(true);

    try {
      // 1. Upload any new photos (those without existingFileId)
      const newToUpload = photos.filter((p) => !p.existingFileId);
      const keptIds = photos
        .filter((p) => p.existingFileId)
        .map((p) => p.existingFileId!) as string[];

      const uploadedIds: string[] = [];

      for (let i = 0; i < newToUpload.length; i++) {
        setSubmitProgress(`Uploading photo ${i + 1} of ${newToUpload.length}…`);
        try {
          const compressed = await compressImage(newToUpload[i].uri);
          const id = await uploadReviewImage(compressed);
          uploadedIds.push(id);
        } catch (err) {
          // If upload fails partway, clean up what we already uploaded
          // so we don't leave orphans
          await Promise.all(uploadedIds.map((id) => deleteImage(id)));
          throw err;
        }
      }

      const finalImageIds = [...keptIds, ...uploadedIds];

      // 2. Save the review
      setSubmitProgress("Saving review…");
      if (editingReviewId) {
        await updateReview(editingReviewId, {
          rating,
          comment: comment.trim() || null,
          imageIds: finalImageIds,
        });

        // 3. Delete any removed images (were on the original but not kept)
        const removed = originalImageIdsRef.current.filter(
          (id) => !keptIds.includes(id),
        );
        await Promise.all(removed.map((id) => deleteImage(id)));
        router.back();
      } else {
        await createReview({
          restaurantId,
          rating,
          comment: comment.trim() || undefined,
          imageIds: finalImageIds,
        });

        // A new review can push the user over a reputation tier — detect it and
        // celebrate before leaving. Best-effort: never block the post on this.
        let earnedNew: ReviewerBadge[] = [];
        if (user) {
          try {
            const stats = await getUserReviewStats(user.id);
            earnedNew = await syncEarnedBadges(stats);
          } catch {
            // ignore — a missed celebration must not fail the review
          }
        }
        if (earnedNew.length > 0) {
          setCelebration(earnedNew); // navigate back when the modal is dismissed
        } else {
          router.back();
        }
      }
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "bottom"]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!restaurant) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "bottom"]}>
        <Text style={styles.errorTitle}>Restaurant not found</Text>
        <Button
          label="Go back"
          onPress={() => router.back()}
          fullWidth={false}
        />
      </SafeAreaView>
    );
  }

  const charsLeft = MAX_COMMENT - comment.length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.kav}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={10}
          >
            <Text style={[styles.cancelText, submitting && styles.disabled]}>
              Cancel
            </Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {editingReviewId ? "Edit review" : "Write a review"}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          <Text style={styles.restaurantName}>{restaurant.name}</Text>

          <Text style={styles.label}>Your rating</Text>
          <View style={styles.starsBig}>
            <StarRating
              value={rating}
              onChange={(v) => {
                setRating(v);
                setRatingError(null);
              }}
              size={36}
            />
          </View>
          {ratingError ? (
            <Text style={styles.errorText}>{ratingError}</Text>
          ) : null}

          <Text style={styles.label}>Comment (optional)</Text>
          <Pressable onPress={() => commentRef.current?.focus()}>
            <TextInput
              ref={commentRef}
              style={styles.commentInput}
              value={comment}
              onChangeText={(t) => {
                if (t.length <= MAX_COMMENT) setComment(t);
              }}
              placeholder="What was the food like? The vibe? The service?"
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              editable={!submitting}
            />
          </Pressable>
          <Text style={styles.charCount}>{charsLeft} characters left</Text>

          <Text style={styles.label}>Photos (optional)</Text>
          <ImagePickerField
            photos={photos}
            onChange={setPhotos}
            max={MAX_PHOTOS}
            disabled={submitting}
          />

          {submitProgress ? (
            <Text style={styles.progress}>{submitProgress}</Text>
          ) : null}

          <View style={styles.submitWrapper}>
            <Button
              label={editingReviewId ? "Save changes" : "Post review"}
              onPress={handleSubmit}
              loading={submitting}
            />
          </View>
        </KeyboardAwareScrollView>
      </View>

      {celebration ? (
        <BadgeEarnedModal
          badges={celebration}
          onClose={() => {
            setCelebration(null);
            router.back();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  kav: { flex: 1 },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelText: { ...typography.body, color: colors.primary, width: 60 },
  disabled: { opacity: 0.4 },
  headerTitle: { ...typography.bodyMedium, color: colors.text },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  restaurantName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "500",
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  starsBig: {
    paddingVertical: spacing.sm,
    alignItems: "flex-start",
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  commentInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  charCount: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "right",
    marginTop: spacing.xs,
  },
  progress: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  submitWrapper: { marginTop: spacing.lg },
  errorTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  });
}
