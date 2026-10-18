// Cloudflare R2 media adapter. The mobile app never receives R2 credentials:
// uploads go through the existing Worker, which validates the Supabase access
// token and restricts every object to the caller's namespace.

import { assertSupabaseSessionCurrent, pinSupabaseSession, type SupabaseSessionIdentity } from "@/services/supabasePinnedSession";
import type { LocalFile } from "@/services/storage";
import { getSupabaseImageUrl, getSupabaseMediaOrigin, SupabaseStorageError } from "@/services/supabaseMediaUrls";
export { getSupabaseImageUrl, SupabaseStorageError } from "@/services/supabaseMediaUrls";

type MediaType = "rest" | "rev" | "usr" | "post";

function mediaUrl(key: string): string {
  return getSupabaseImageUrl(key)!;
}

function extension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function randomName(): string {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now()}-${random}`;
}

async function mediaIdentity(): Promise<SupabaseSessionIdentity> {
  const pinned = await pinSupabaseSession();
  if (!pinned) throw new SupabaseStorageError("You must be signed in. Your account may have changed.");
  return pinned;
}

async function mediaRequest(identity: SupabaseSessionIdentity, url: string, options: RequestInit): Promise<Response> {
  await assertSupabaseSessionCurrent(identity);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal,
      headers: { ...options.headers, authorization: `Bearer ${identity.accessToken}` } });
    await assertSupabaseSessionCurrent(identity);
    return response;
  } finally { clearTimeout(timer); }
}

export async function uploadSupabaseImage(file: LocalFile, type: MediaType): Promise<string> {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
    throw new SupabaseStorageError("Unsupported file type. Use JPG, PNG, or WebP.");
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new SupabaseStorageError("Image must be 10 MB or smaller.");
  }

  const identity = await mediaIdentity();
  const key = `${type}/${identity.userId}/${randomName()}.${extension(file.type)}`;
  const body = await fetch(file.uri).then((response) => response.blob());
  if (body.size <= 0 || body.size > 10 * 1024 * 1024) throw new SupabaseStorageError("Image must be 10 MB or smaller.");

  const response = await mediaRequest(identity, mediaUrl(key), {
    method: "PUT",
    headers: { "content-type": file.type, "content-length": String(body.size) },
    body,
  });
  if (!response.ok) {
    throw new SupabaseStorageError(response.status === 413 ? "Image must be 10 MB or smaller." : "Upload failed. Please try again.");
  }
  return key;
}

export async function deleteSupabaseImage(key: string): Promise<void> {
  if (!key || key.startsWith("http")) return;
  const identity = await mediaIdentity();
  const response = await mediaRequest(identity, mediaUrl(key), {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new SupabaseStorageError("Could not delete the image.");
  }
}

/** Opportunistic admin drain; failed/expired leases stay queued for a retry. */
export async function processSupabaseMediaCleanup(expected?: SupabaseSessionIdentity):Promise<void> {
  const workerOrigin=getSupabaseMediaOrigin();
  if (!workerOrigin) throw new SupabaseStorageError("Image storage is not configured yet.");
  const identity = expected ?? await mediaIdentity();
  for (let batch=0;batch<10;batch++) {
    const response=await mediaRequest(identity, `${workerOrigin}/media/cleanup`,{ method:"POST" });
    if (!response.ok) throw new SupabaseStorageError("Image cleanup is temporarily unavailable.");
    const data=await response.json() as { claimed:number;failed:number };
    await assertSupabaseSessionCurrent(identity);
    if (!Number.isInteger(data.claimed) || data.claimed<0 || data.claimed>20 || !Number.isInteger(data.failed)
      || data.failed<0 || data.failed>data.claimed) throw new SupabaseStorageError("Invalid image cleanup response.");
    if (data.failed>0 || data.claimed<20) break;
  }
}

export const uploadSupabaseRestaurantImage = (file: LocalFile) => uploadSupabaseImage(file, "rest");
export const uploadSupabaseReviewImage = (file: LocalFile) => uploadSupabaseImage(file, "rev");
export const uploadSupabaseAvatar = (file: LocalFile) => uploadSupabaseImage(file, "usr");
export const uploadSupabasePostImage = (file: LocalFile) => uploadSupabaseImage(file, "post");
