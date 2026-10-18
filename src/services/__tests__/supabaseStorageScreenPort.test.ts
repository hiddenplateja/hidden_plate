import * as ImageManipulator from "expo-image-manipulator";
import { loadSupabaseStorageScreenPort } from "@/services/supabaseStorageScreenPort";
import { compressImage, compressAvatar } from "@/services/imageCompression";
import type { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
jest.mock("expo-image-manipulator", () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: "jpeg" } }));
jest.mock("@/services/appwrite", () => { throw new Error("Compression/ports must not initialize Appwrite"); });
const uploadRestaurant = jest.fn(), uploadReview = jest.fn(), uploadAvatar = jest.fn(), uploadPost = jest.fn(), deleteImage = jest.fn();
const file = { uri: "file:///photo.jpg", name: "photo.jpg", type: "image/jpeg", size: 1024 };
const gateway = { load: jest.fn(async () => ({ uploadSupabaseRestaurantImage: uploadRestaurant, uploadSupabaseReviewImage: uploadReview,
  uploadSupabaseAvatar: uploadAvatar, uploadSupabasePostImage: uploadPost, deleteSupabaseImage: deleteImage })) } as unknown as ReturnType<typeof createSupabaseTestBackend>;
let originalFetch: typeof fetch, originalMedia: string | undefined;
beforeEach(() => {
  jest.clearAllMocks(); originalFetch = global.fetch; originalMedia = process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = "https://media.example.test";
  (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({ uri: "file:///compressed.jpg" });
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 1234 }) })) as unknown as typeof fetch;
  for (const upload of [uploadRestaurant, uploadReview, uploadAvatar, uploadPost]) upload.mockResolvedValue("rest/user/photo.jpg");
  deleteImage.mockResolvedValue(undefined);
});
afterEach(() => { global.fetch = originalFetch;
  if (originalMedia === undefined) delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL; else process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = originalMedia; });

test.each([["photo", compressImage, 1600, 0.8], ["avatar", compressAvatar, 600, 0.75]] as const)("%s compression keeps existing Expo dimensions/quality/JPEG format", async (prefix, compress, width, quality) => {
  const result = await compress("file:///source.png");
  expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith("file:///source.png", [{ resize: { width } }], { compress: quality, format: "jpeg" });
  expect(global.fetch).toHaveBeenCalledWith("file:///compressed.jpg");
  expect(result).toMatchObject({ uri: "file:///compressed.jpg", type: "image/jpeg", size: 1234 });
  expect(result.name).toMatch(new RegExp(`^${prefix}-[0-9]+\\.jpg$`));
});
test("compression failures still propagate as before", async () => {
  (ImageManipulator.manipulateAsync as jest.Mock).mockRejectedValue(new Error("native failure"));
  await expect(compressImage("file:///bad")).rejects.toThrow("native failure");
});
test("image URL helpers stay synchronous and support R2 keys, empty avatars, and OAuth URLs", async () => {
  const port = await loadSupabaseStorageScreenPort(gateway);
  expect(port.getImageViewUrl("rest/user/image.jpg")).toBe("https://media.example.test/media/rest/user/image.jpg");
  expect(port.getImagePreviewUrl("rev/user/image.jpg", { width: 120, height: 80 })).toBe("https://media.example.test/media/rev/user/image.jpg");
  expect(port.getAvatarUrl(null)).toBeNull(); expect(port.getAvatarUrl(undefined)).toBeNull();
  expect(port.getAvatarUrl("https://provider.example.test/avatar.jpg")).toBe("https://provider.example.test/avatar.jpg");
  expect(port.compressImage).toBe(compressImage); expect(port.compressAvatar).toBe(compressAvatar);
  expect(() => port.getImageViewUrl("")).toThrow("identifier is missing");
});
test.each([["rest", "rest"], ["rev", "rev"], ["usr", "usr"], ["post", "post"], ["other", "unknown"]] as const)("media type preserves %s -> %s", async (prefix, expected) => {
  const port = await loadSupabaseStorageScreenPort(gateway); expect(port.getMediaType(`${prefix}/user/file.jpg`)).toBe(expected);
});
test("uploads retain 5MB review/post and 3MB avatar client limits", async () => {
  const port = await loadSupabaseStorageScreenPort(gateway);
  await expect(port.uploadReviewImage({ ...file, size: 5 * 1024 * 1024 + 1 })).rejects.toThrow("5 MB");
  await expect(port.uploadPostImage({ ...file, size: 5 * 1024 * 1024 + 1 })).rejects.toThrow("5 MB");
  await expect(port.uploadAvatar({ ...file, size: 3 * 1024 * 1024 + 1 })).rejects.toThrow("3 MB");
  expect(uploadReview).not.toHaveBeenCalled(); expect(uploadPost).not.toHaveBeenCalled(); expect(uploadAvatar).not.toHaveBeenCalled();
  await port.uploadRestaurantImage(file); await port.uploadReviewImage(file); await port.uploadAvatar(file); await port.uploadPostImage(file);
  expect(uploadRestaurant).toHaveBeenCalledWith(file); expect(uploadReview).toHaveBeenCalledWith(file);
});
test("image deletion stays best-effort and does not log or replace the caller's flow", async () => {
  const port = await loadSupabaseStorageScreenPort(gateway); deleteImage.mockRejectedValue(new Error("retry later"));
  await expect(port.deleteImage("rev/user/photo.jpg")).resolves.toBeUndefined();
});
