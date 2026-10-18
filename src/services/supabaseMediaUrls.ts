// Pure URL mapping shared by profile and storage adapters; no auth/native imports.
import { BACKEND_PUBLIC_CONFIGURATION } from "@/services/backendPublicConfiguration";
export class SupabaseStorageError extends Error {
  constructor(message:string) { super(message); this.name="SupabaseStorageError"; }
}
export function getSupabaseMediaOrigin():string {
  const explicit=process.env.EXPO_PUBLIC_MEDIA_WORKER_URL?.trim();
  if (explicit) return explicit.replace(/\/$/,"");
  return BACKEND_PUBLIC_CONFIGURATION.mediaUrl;
}
export function getSupabaseImageUrl(key:string|null|undefined):string|null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  const origin=getSupabaseMediaOrigin();
  if (!origin) throw new SupabaseStorageError("Image storage is not configured yet.");
  return `${origin}/media/${key}`;
}
