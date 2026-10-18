import { restoreAuthSnapshot, SIGNED_OUT_SNAPSHOT } from "@/utils/authSession";

test("successful bootstrap clears its timeout", async () => {
  jest.useFakeTimers();
  expect(await restoreAuthSnapshot(async () => ({ ...SIGNED_OUT_SNAPSHOT }))).toEqual(SIGNED_OUT_SNAPSHOT);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
test("a hung profile/role/preferences bootstrap cannot hold the splash forever", async () => {
  jest.useFakeTimers();
  const result = restoreAuthSnapshot(() => new Promise(() => {}));
  await jest.advanceTimersByTimeAsync(8000);
  expect(await result).toEqual(SIGNED_OUT_SNAPSHOT);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
test("failed bootstrap safely settles signed out", async () => {
  expect(await restoreAuthSnapshot(async () => { throw new Error("Offline"); })).toEqual(SIGNED_OUT_SNAPSHOT);
});
