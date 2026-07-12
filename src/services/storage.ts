// src/services/storage.ts
// Media upload + URL helpers.
//
// We use ONE Appwrite Storage bucket ("media") and prefix file IDs by type:
//   rest_<uuid> — restaurant images
//   rev_<uuid>  — review images
//   usr_<uuid>  — user avatars
//
// This lets us keep one bucket for the free tier while still being able to
// tell file types apart later (cleanup scripts, analytics, etc.).
//
// NOTE: Appwrite Cloud free tier blocks image transformations (getFilePreview).
// We use getFileView (serves original) and rely on expo-image's caching to
// mitigate bandwidth. Upgrade Appwrite plan to enable on-the-fly resize.
//
// URL strategy: we BUILD the URL manually instead of relying on the SDK's
// getFileView return value. The SDK has been inconsistent across versions
// (string vs URL object vs custom wrapper), and a manual build is bulletproof.

import * as ImageManipulator from "expo-image-manipulator";
import { AppwriteException, ID } from "react-native-appwrite";

import { appwriteConfig, storage } from "@/services/appwrite";

export class StorageError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

// ---------- File-ID helpers ----------

type MediaType = "rest" | "rev" | "usr" | "post";

function makeId(type: MediaType): string {
  // ID.unique() returns a 20-char alphanumeric string.
  // Total length: 4 prefix + ID.unique() = ~24 chars (fits in 36-char fields).
  return `${type}_${ID.unique()}`;
}

// ---------- URL builder ----------

/**
 * Build the Appwrite Storage file-view URL manually.
 * Format: {endpoint}/storage/buckets/{bucketId}/files/{fileId}/view?project={projectId}
 * This bypasses SDK return-type inconsistencies.
 */
function buildFileUrl(fileId: string): string {
  const { endpoint, projectId, buckets } = appwriteConfig;
  return `${endpoint}/storage/buckets/${buckets.media}/files/${fileId}/view?project=${projectId}`;
}

// ---------- URL helpers ----------

interface PreviewOptions {
  width?: number;
  height?: number;
  quality?: number;
}

/**
 * Get a preview URL for an image. On the free tier this returns the original
 * (full-resolution) file. When you upgrade Appwrite, swap to a transformation
 * URL — the call sites don't change.
 */
export function getImagePreviewUrl(
  fileId: string,
  _options: PreviewOptions = {},
): string {
  return buildFileUrl(fileId);
}

/**
 * Get the full-resolution URL (use sparingly — full-detail view only).
 */
export function getImageViewUrl(fileId: string): string {
  return buildFileUrl(fileId);
}

/**
 * Convenience helper that returns null when fileId is null/undefined.
 * Used everywhere we render an avatar — saves the caller from null-checking.
 */
export function getAvatarUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  // OAuth users store their provider profile photo URL directly in avatarUrl
  // (not a Storage file id) — pass any absolute URL straight through.
  if (fileId.startsWith("http")) return fileId;
  return getImageViewUrl(fileId);
}

// ---------- Image compression ----------

const COMPRESS_MAX_WIDTH = 1600;
const COMPRESS_QUALITY = 0.8;

/**
 * Compress an image before upload. Resizes to max 1600px wide (preserves
 * aspect ratio) and re-encodes as JPEG at 80% quality.
 *
 * Why: iPhone photos are often 4MB+, way larger than needed for restaurant
 * shots displayed at <1000px wide. Compression cuts upload size 5-10x,
 * saves bandwidth, and stays under the free-tier storage quota longer.
 *
 * Returns a LocalFile ready to pass to upload* helpers.
 */
export async function compressImage(sourceUri: string): Promise<LocalFile> {
  const result = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: COMPRESS_MAX_WIDTH } }],
    {
      compress: COMPRESS_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  // Get the final size — RN doesn't expose this directly, so we approximate
  // via fetch->blob. Acceptable for upload-time validation.
  const response = await fetch(result.uri);
  const blob = await response.blob();

  return {
    uri: result.uri,
    name: `photo-${Date.now()}.jpg`,
    type: "image/jpeg",
    size: blob.size,
  };
}

/**
 * Compress specifically for avatar uploads. Smaller max width and tighter
 * quality — avatars display at maybe 80-120px, so a 600px source is plenty.
 */
export async function compressAvatar(sourceUri: string): Promise<LocalFile> {
  const result = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: 600 } }],
    {
      compress: 0.75,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  const response = await fetch(result.uri);
  const blob = await response.blob();

  return {
    uri: result.uri,
    name: `avatar-${Date.now()}.jpg`,
    type: "image/jpeg",
    size: blob.size,
  };
}

// ---------- Upload ----------

export interface LocalFile {
  uri: string;
  name: string;
  type: string; // mime type, e.g. "image/jpeg"
  size: number;
}

const MAX_RESTAURANT_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REVIEW_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB — avatars don't need to be huge

async function uploadFile(
  file: LocalFile,
  mediaType: MediaType,
): Promise<string> {
  const fileId = makeId(mediaType);

  try {
    const result = await storage.createFile(
      appwriteConfig.buckets.media,
      fileId,
      {
        uri: file.uri,
        name: file.name,
        type: file.type,
        size: file.size,
      },
    );
    return result.$id;
  } catch (err) {
    if (err instanceof AppwriteException) {
      if (err.code === 400 && err.message.includes("size")) {
        throw new StorageError("Image is too large.");
      }
      if (err.code === 400 && err.message.includes("extension")) {
        throw new StorageError("Unsupported file type. Use JPG, PNG, or WebP.");
      }
      throw new StorageError(err.message || "Upload failed.", err.type);
    }
    throw new StorageError("Upload failed.");
  }
}

export async function uploadRestaurantImage(file: LocalFile): Promise<string> {
  if (file.size > MAX_RESTAURANT_IMAGE_BYTES) {
    throw new StorageError("Image must be 10 MB or smaller.");
  }
  return uploadFile(file, "rest");
}

export async function uploadReviewImage(file: LocalFile): Promise<string> {
  if (file.size > MAX_REVIEW_IMAGE_BYTES) {
    throw new StorageError("Image must be 5 MB or smaller.");
  }
  return uploadFile(file, "rev");
}

export async function uploadAvatar(file: LocalFile): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) {
    throw new StorageError("Image must be 3 MB or smaller.");
  }
  return uploadFile(file, "usr");
}

/** Community post photos — same size cap as review photos. */
export async function uploadPostImage(file: LocalFile): Promise<string> {
  if (file.size > MAX_REVIEW_IMAGE_BYTES) {
    throw new StorageError("Image must be 5 MB or smaller.");
  }
  return uploadFile(file, "post");
}

export async function deleteImage(fileId: string): Promise<void> {
  try {
    await storage.deleteFile(appwriteConfig.buckets.media, fileId);
  } catch (err) {
    // Don't throw — deletion failures shouldn't break user flows
    console.warn("[storage] delete failed:", err);
  }
}

/**
 * Inspect a file ID to see what type of media it is.
 * Useful for cleanup scripts and analytics.
 */
export function getMediaType(fileId: string): MediaType | "unknown" {
  if (fileId.startsWith("rest_")) return "rest";
  if (fileId.startsWith("rev_")) return "rev";
  if (fileId.startsWith("usr_")) return "usr";
  if (fileId.startsWith("post_")) return "post";
  return "unknown";
}
