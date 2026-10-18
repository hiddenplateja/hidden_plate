import { getSupabaseImageUrl, SupabaseStorageError } from "@/services/supabaseMediaUrls";
import type * as Storage from "@/services/storage";
import type { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
import type { LocalFile } from "@/services/imageCompression";

function imageUrl(id: string): string {
  const url = getSupabaseImageUrl(id);
  if (!url) throw new SupabaseStorageError("Image identifier is missing.");
  return url;
}
function validateSize(file: LocalFile, megabytes: number) {
  if (file.size > megabytes * 1024 * 1024) throw new SupabaseStorageError(`Image must be ${megabytes} MB or smaller.`);
}
/** Load only on explicit test integration. Synchronous URL functions remain synchronous. */
export async function loadSupabaseStorageScreenPort(gateway: ReturnType<typeof createSupabaseTestBackend>) {
  const [storage, compression] = await Promise.all([gateway.load("storage"), import("@/services/imageCompression")]);
  return Object.freeze({
    getImagePreviewUrl: (id: string, _options: Parameters<typeof Storage.getImagePreviewUrl>[1] = {}) => imageUrl(id),
    getImageViewUrl: imageUrl,
    getAvatarUrl: getSupabaseImageUrl,
    compressImage: compression.compressImage,
    compressAvatar: compression.compressAvatar,
    uploadRestaurantImage: (file: LocalFile) => storage.uploadSupabaseRestaurantImage(file),
    uploadReviewImage: async (file: LocalFile) => { validateSize(file, 5); return storage.uploadSupabaseReviewImage(file); },
    uploadAvatar: async (file: LocalFile) => { validateSize(file, 3); return storage.uploadSupabaseAvatar(file); },
    uploadPostImage: async (file: LocalFile) => { validateSize(file, 5); return storage.uploadSupabasePostImage(file); },
    // Preserve legacy best-effort cleanup; DB cleanup jobs own reliable retries.
    deleteImage: async (id: string) => { await storage.deleteSupabaseImage(id).catch(() => {}); },
    getMediaType: (id: string): ReturnType<typeof Storage.getMediaType> => {
      const prefix = id.split("/", 1)[0];
      return prefix === "rest" || prefix === "rev" || prefix === "usr" || prefix === "post" ? prefix : "unknown";
    },
  } satisfies Omit<typeof Storage, "StorageError">);
}
