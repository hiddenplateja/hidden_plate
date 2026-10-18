import type { AccountAction } from "@/utils/accountActionScope";
/** Preserve upload ordering/partial-failure cleanup, but never adopt a new actor. */
export async function uploadAccountPhotos<File>(action: AccountAction, photos: readonly { uri: string }[], operations: {
  compress(uri: string): Promise<File>; upload(file: File): Promise<string>; remove(id: string): Promise<void>;
  progress?(index: number, total: number): void;
}): Promise<string[]> {
  const uploaded: string[] = [];
  try {
    for (let index = 0; index < photos.length; index++) {
      action.assertCurrent(); operations.progress?.(index + 1, photos.length);
      const file = await action.run(() => operations.compress(photos[index].uri));
      uploaded.push(await action.run(() => operations.upload(file)));
    }
    action.assertCurrent();
    return uploaded;
  } catch (error) {
    // Old-account leftovers must not be deleted using a replacement session.
    // Already-finished remote writes cannot be rolled back by this guard.
    if (action.isCurrent()) await Promise.all(uploaded.map(id => action.run(() => operations.remove(id))));
    throw error;
  }
}
