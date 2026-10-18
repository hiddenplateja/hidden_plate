// Backend-selecting facade. Legacy types are erased; SDK loading is lazy.
import type * as Legacy from "@/services/legacy/storage";
import { dispatchBackendService, getRuntimeBackend } from "@/services/backendRuntime";
import { StorageError } from "@/services/serviceErrors";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
import { getSupabaseImageUrl } from "@/services/supabaseMediaUrls";
export { StorageError } from "@/services/serviceErrors";
export { compressImage, compressAvatar } from "@/services/imageCompression";
export type { LocalFile } from "@/services/imageCompression";
export const getImagePreviewUrl: typeof Legacy.getImagePreviewUrl = id => { if (getRuntimeBackend() === "supabase") { const url=getSupabaseImageUrl(id); if (!url) throw new StorageError("Image identifier is missing."); return url; } const {endpoint,projectId,buckets}=getAppwriteConfiguration(); return `${endpoint}/storage/buckets/${buckets.media}/files/${id}/view?project=${projectId}`; };
export const getImageViewUrl: typeof Legacy.getImageViewUrl = id => { if (getRuntimeBackend() === "supabase") { const url=getSupabaseImageUrl(id); if (!url) throw new StorageError("Image identifier is missing."); return url; } const {endpoint,projectId,buckets}=getAppwriteConfiguration(); return `${endpoint}/storage/buckets/${buckets.media}/files/${id}/view?project=${projectId}`; };
export const getAvatarUrl: typeof Legacy.getAvatarUrl = id => { if (getRuntimeBackend() === "supabase") return getSupabaseImageUrl(id); if (!id) return null; return id.startsWith("http") ? id : getImageViewUrl(id); };
export const uploadRestaurantImage: typeof Legacy.uploadRestaurantImage = (...args) => dispatchBackendService<typeof Legacy.uploadRestaurantImage>("storage", "uploadRestaurantImage", args, () => import("@/services/legacy/storage"), StorageError);
export const uploadReviewImage: typeof Legacy.uploadReviewImage = (...args) => dispatchBackendService<typeof Legacy.uploadReviewImage>("storage", "uploadReviewImage", args, () => import("@/services/legacy/storage"), StorageError);
export const uploadAvatar: typeof Legacy.uploadAvatar = (...args) => dispatchBackendService<typeof Legacy.uploadAvatar>("storage", "uploadAvatar", args, () => import("@/services/legacy/storage"), StorageError);
export const uploadPostImage: typeof Legacy.uploadPostImage = (...args) => dispatchBackendService<typeof Legacy.uploadPostImage>("storage", "uploadPostImage", args, () => import("@/services/legacy/storage"), StorageError);
export const deleteImage: typeof Legacy.deleteImage = (...args) => dispatchBackendService<typeof Legacy.deleteImage>("storage", "deleteImage", args, () => import("@/services/legacy/storage"), StorageError);
export const getMediaType: typeof Legacy.getMediaType = id => { if (getRuntimeBackend() === "supabase") { const type = id.split("/",1)[0]; return type === "rest" || type === "rev" || type === "usr" || type === "post" ? type : "unknown"; } if (id.startsWith("rest_")) return "rest"; if (id.startsWith("rev_")) return "rev"; if (id.startsWith("usr_")) return "usr"; if (id.startsWith("post_")) return "post"; return "unknown"; };
