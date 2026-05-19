// src/components/ImagePickerField.tsx
// Image-picker UI for the review composer.
//
// Behavior:
//   - "Add photos" tile opens the camera roll picker (multiselect, capped at max)
//   - Each picked photo shows as a thumbnail with a small X to remove
//   - Tile shows remaining slots ("3/6") so users know the cap
//
// Photos are NOT uploaded here — that happens at submit time. This component
// just collects local URIs that the parent passes to the upload step.

import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { colors, radius, spacing, typography } from "@/theme/colors";

export interface PickedPhoto {
  // Local URI from the picker. Stable for the duration of the screen.
  uri: string;
  // For existing photos already on a review (edit mode), we track the
  // Storage file ID so we know NOT to re-upload them.
  existingFileId?: string;
}

interface ImagePickerFieldProps {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  max?: number;
  disabled?: boolean;
}

export function ImagePickerField({
  photos,
  onChange,
  max = 6,
  disabled = false,
}: ImagePickerFieldProps) {
  const [picking, setPicking] = useState(false);

  const remaining = max - photos.length;

  const handlePick = async () => {
    if (remaining <= 0 || disabled) return;
    setPicking(true);
    try {
      // Request permission first (no-op if already granted)
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Photo access needed",
          "Allow Hidden Plate to access your photos to add them to your review.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1, // we compress later in storage.ts; pick at full quality here
        // exif: false intentionally — strips location data from photos for privacy
        exif: false,
      });

      if (result.canceled) return;

      const newPhotos: PickedPhoto[] = result.assets.map((a) => ({
        uri: a.uri,
      }));

      onChange([...photos, ...newPhotos].slice(0, max));
    } catch (err) {
      Alert.alert(
        "Couldn't pick photos",
        err instanceof Error ? err.message : "Try again.",
      );
    } finally {
      setPicking(false);
    }
  };

  const handleRemove = (index: number) => {
    const next = [...photos];
    next.splice(index, 1);
    onChange(next);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {photos.map((photo, i) => (
        <View key={`${photo.uri}-${i}`} style={styles.thumbWrapper}>
          <Image
            source={{ uri: photo.uri }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
          />
          <Pressable
            onPress={() => handleRemove(i)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${i + 1}`}
            style={({ pressed }) => [
              styles.removeButton,
              pressed && styles.pressed,
            ]}
            hitSlop={6}
          >
            <Text style={styles.removeX}>×</Text>
          </Pressable>
        </View>
      ))}

      {remaining > 0 ? (
        <Pressable
          onPress={handlePick}
          disabled={disabled || picking}
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          style={({ pressed }) => [
            styles.addTile,
            pressed && !picking && styles.pressed,
            (disabled || picking) && styles.addTileDisabled,
          ]}
        >
          {picking ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Text style={styles.plus}>+</Text>
              <Text style={styles.addLabel}>
                {photos.length === 0 ? "Add photos" : `${photos.length}/${max}`}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const THUMB_SIZE = 84;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  thumbWrapper: {
    position: "relative",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  removeButton: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeX: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
  addTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  addTileDisabled: {
    opacity: 0.5,
  },
  plus: {
    fontSize: 28,
    color: colors.primary,
    marginBottom: 2,
  },
  addLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
