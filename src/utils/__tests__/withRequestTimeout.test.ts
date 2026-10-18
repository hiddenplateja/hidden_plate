import { AbortController as NativeAbortController, AbortSignal as NativeAbortSignal } from "abort-controller";
import { withRequestTimeout } from "@/utils/withRequestTimeout";

const originalController = global.AbortController;
const originalSignal = global.AbortSignal;
beforeEach(() => {
  jest.useFakeTimers();
  // The implementation installed by React Native 0.81's setUpXHR.js.
  global.AbortController = NativeAbortController as unknown as typeof AbortController;
  global.AbortSignal = NativeAbortSignal as unknown as typeof AbortSignal;
});
afterEach(() => {
  jest.useRealTimers();
  global.AbortController = originalController; global.AbortSignal = originalSignal;
});

test("works when native AbortSignal.timeout is absent and clears a successful request's timer", async () => {
  expect(typeof AbortSignal.timeout).toBe("undefined");
  await expect(withRequestTimeout(5000, async signal => {
    expect(signal.aborted).toBe(false); return "registered";
  })).resolves.toBe("registered");
  expect(jest.getTimerCount()).toBe(0);
});

test("aborts at the deadline and releases the timer when the request rejects", async () => {
  const pending = withRequestTimeout(1500, signal => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  const assertion = expect(pending).rejects.toThrow("aborted");
  jest.advanceTimersByTime(1500); await assertion;
  expect(jest.getTimerCount()).toBe(0);
});

test("cleans up both immediate exceptions and rejected thenables", async () => {
  await expect(withRequestTimeout(5000, () => { throw new Error("sync failure"); })).rejects.toThrow("sync failure");
  await expect(withRequestTimeout(5000, () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  expect(jest.getTimerCount()).toBe(0);
});
