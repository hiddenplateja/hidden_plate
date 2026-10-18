import { createAccountActionScope, beginUnscopedAction } from "@/utils/accountActionScope";
import { uploadAccountPhotos } from "@/utils/accountPhotoUpload";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let identity: { userId: string | null; revision: number };
function scope() { const value = createAccountActionScope("a", () => identity); value.activate(); return value; }
beforeEach(() => { identity = { userId: "a", revision: 1 }; });
test("actions need an active mounted owner and cannot start as another user", () => {
  const value = createAccountActionScope("a", () => identity);
  expect(value.begin().isCurrent()).toBe(false); value.activate(); expect(value.begin().isCurrent()).toBe(true);
  identity = { userId: "b", revision: 2 }; expect(value.begin().isCurrent()).toBe(false);
});
test("unmount and strict-effect reactivation invalidate all earlier callbacks", () => {
  const value = scope(), action = value.begin(); value.dispose();
  expect(action.canUpdate()).toBe(false); value.activate();
  expect(action.isCurrent()).toBe(false); expect(value.begin().isCurrent()).toBe(true);
});
test("a token rotation cancels work but still lets the same screen clear its busy flag", () => {
  const action = scope().begin(); identity.revision++;
  expect(action.isCurrent()).toBe(false); expect(action.canUpdate()).toBe(true);
  identity.userId = "b"; expect(action.canUpdate()).toBe(false);
});
test("a sign-out/re-sign-in as the same owner cannot revive an older ticket", () => {
  const action = scope().begin(); identity = { userId: null, revision: 2 }; identity = { userId: "a", revision: 3 };
  expect(action.isCurrent()).toBe(false);
});
test("an old delayed confirmation cannot start a mutation", async () => {
  const action = scope().begin(), save = jest.fn(); identity = { userId: "b", revision: 2 };
  await expect(action.run(save)).rejects.toThrow("account or screen changed"); expect(save).not.toHaveBeenCalled();
});
test("compression -> upload -> save keeps order and progress on success", async () => {
  const action = scope().begin(), order: string[] = [], progress = jest.fn();
  const ids = await uploadAccountPhotos(action, [{ uri: "one" }, { uri: "two" }], {
    compress: async uri => { order.push(`compress:${uri}`); return uri; },
    upload: async file => { order.push(`upload:${file}`); return file; }, remove: jest.fn(), progress,
  });
  await action.run(async () => { order.push("save"); });
  expect(ids).toEqual(["one", "two"]); expect(order).toEqual(["compress:one", "upload:one", "compress:two", "upload:two", "save"]);
  expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
});
test("a switch during compression prevents upload, save and old-account cleanup", async () => {
  const action = scope().begin(), delayed = deferred<string>(), upload = jest.fn(), remove = jest.fn(), save = jest.fn();
  const pending = uploadAccountPhotos(action, [{ uri: "one" }], { compress: () => delayed.promise, upload, remove });
  identity = { userId: "b", revision: 2 }; delayed.resolve("file");
  await expect(pending).rejects.toThrow();
  await expect(action.run(save)).rejects.toThrow();
  expect(upload).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
test("a normal partial upload failure still cleans earlier uploads", async () => {
  const action = scope().begin(), remove = jest.fn(), upload = jest.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("offline"));
  await expect(uploadAccountPhotos(action, [{ uri: "one" }, { uri: "two" }], { compress: async uri => uri, upload, remove })).rejects.toThrow("offline");
  expect(remove).toHaveBeenCalledWith("first");
});
test("an account switch during a later upload never cleans earlier files as the new account", async () => {
  const action = scope().begin(), remove = jest.fn(), upload = jest.fn().mockResolvedValueOnce("first").mockImplementationOnce(async () => {
    identity = { userId: "b", revision: 2 }; return "second";
  });
  await expect(uploadAccountPhotos(action, [{ uri: "one" }, { uri: "two" }], { compress: async uri => uri, upload, remove })).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
});
test("success after unmount cannot navigate or show an old alert", async () => {
  const value = scope(), action = value.begin(), delayed = deferred<void>(), navigate = jest.fn(), alert = jest.fn();
  const pending = action.run(() => delayed.promise).then(navigate).catch(() => { if (action.isCurrent()) alert(); });
  value.dispose(); delayed.resolve(); await pending;
  expect(navigate).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
});
test("the Appwrite passthrough retains its original execution behavior", async () => {
  const action = beginUnscopedAction(), operation = jest.fn().mockResolvedValue("legacy");
  identity = { userId: "b", revision: 999 };
  expect(action.isCurrent()).toBe(true); expect(await action.run(operation)).toBe("legacy");
});
