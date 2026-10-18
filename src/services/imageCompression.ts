// Backend-independent compression; retain the existing Expo native settings.
import * as ImageManipulator from "expo-image-manipulator";
export interface LocalFile { uri: string; name: string; type: string; size: number }

export async function compressImage(sourceUri: string): Promise<LocalFile> {
  const result = await ImageManipulator.manipulateAsync(sourceUri, [{ resize: { width: 1600 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  const response = await fetch(result.uri);
  const blob = await response.blob();
  return { uri: result.uri, name: `photo-${Date.now()}.jpg`, type: "image/jpeg", size: blob.size };
}
export async function compressAvatar(sourceUri: string): Promise<LocalFile> {
  const result = await ImageManipulator.manipulateAsync(sourceUri, [{ resize: { width: 600 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG });
  const response = await fetch(result.uri);
  const blob = await response.blob();
  return { uri: result.uri, name: `avatar-${Date.now()}.jpg`, type: "image/jpeg", size: blob.size };
}
