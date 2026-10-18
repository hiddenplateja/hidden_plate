import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { getSupabaseUserPreferences, updateSupabaseUserPreferences } from "@/services/supabaseUserPreferences";
import { uploadSupabaseAvatar, deleteSupabaseImage, processSupabaseMediaCleanup } from "@/services/supabaseStorage";

jest.mock("@/services/supabase", () => ({ supabase: { auth: { getSession: jest.fn() } }, createIsolatedSupabaseAuthClient: jest.fn() }));
const getSession = supabase.auth.getSession as jest.Mock;
const getUser = jest.fn(), rpc = jest.fn(), from = jest.fn(), header = jest.fn();
const sessionA = { user: { id: "user-a" }, access_token: "fixture-token-a" };
const sessionB = { user: { id: "user-b" }, access_token: "fixture-token-b" };
const originalFetch = global.fetch;
const originalOrigin = process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
let fetchMock: jest.Mock;
const file = { uri: "file:///fixture.jpg", name: "fixture.jpg", type: "image/jpeg", size: 20 };
beforeEach(() => {
  jest.resetAllMocks();
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = "https://media.example.test";
  getSession.mockResolvedValue({ data: { session: sessionA } });
  getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
  rpc.mockReturnValue({ setHeader: header });
  from.mockReturnValue({ select: () => ({ eq: () => ({ single: () => ({ setHeader: header }) }) }) });
  header.mockResolvedValue({ data: { notifyOnLike: false }, error: null });
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue({ auth: { getUser }, rpc, from });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => ({ size: 20 }), json: async () => ({ claimed: 0, failed: 0 }) });
  global.fetch = fetchMock;
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalOrigin === undefined) delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
  else process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = originalOrigin;
});
test("settings requests verify the token and use a fixed authorization header", async () => {
  expect(await updateSupabaseUserPreferences({ notifyOnLike: false })).toMatchObject({ notifyOnLike: false });
  expect(getUser).toHaveBeenCalledWith("fixture-token-a");
  expect(header).toHaveBeenCalledWith("Authorization", "Bearer fixture-token-a");
  expect(rpc).toHaveBeenCalledWith("merge_my_preferences", { preference_patch: { notifyOnLike: false } });
});
test("a switch during proof prevents settings writes", async () => {
  getUser.mockImplementation(async () => {
    getSession.mockResolvedValue({ data: { session: sessionB } });
    return { data: { user: { id: "user-a" } } };
  });
  await expect(updateSupabaseUserPreferences({})).rejects.toThrow("account may have changed");
  expect(rpc).not.toHaveBeenCalled();
});
test("settings writes do not publish stale success; private reads return defaults on a switch", async () => {
  header.mockImplementation(async () => {
    getSession.mockResolvedValue({ data: { session: sessionB } });
    return { data: { preferences: { favoriteCuisines: ["private-a"] } } };
  });
  await expect(updateSupabaseUserPreferences({})).rejects.toThrow("account changed");
  getSession.mockResolvedValue({ data: { session: sessionA } });
  expect((await getSupabaseUserPreferences()).favoriteCuisines).toEqual([]);
});
test("upload keys and headers belong to the same verified account", async () => {
  expect(await uploadSupabaseAvatar(file)).toMatch(/^usr\/user-a\/.+\.jpg$/);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT", headers: { authorization: "Bearer fixture-token-a" } });
});
test("switching while the local image loads prevents the remote upload", async () => {
  fetchMock.mockImplementation(async () => {
    getSession.mockResolvedValue({ data: { session: sessionB } });
    return { blob: async () => ({ size: 20 }) };
  });
  await expect(uploadSupabaseAvatar(file)).rejects.toThrow("account changed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("the actual body size is validated, not only the supplied metadata", async () => {
  fetchMock.mockResolvedValue({ blob: async () => ({ size: 11 * 1024 * 1024 }) });
  await expect(uploadSupabaseAvatar(file)).rejects.toThrow("10 MB");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("a switch after DELETE rejects its stale success without retrying as the new account", async () => {
  fetchMock.mockImplementation(async () => {
    getSession.mockResolvedValue({ data: { session: sessionB } });
    return { ok: true };
  });
  await expect(deleteSupabaseImage("usr/user-a/fixture.jpg")).rejects.toThrow("account changed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer fixture-token-a");
});
test("cleanup never continues batches under a different account", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => {
    getSession.mockResolvedValue({ data: { session: sessionB } });
    return { claimed: 20, failed: 0 };
  } });
  await expect(processSupabaseMediaCleanup()).rejects.toThrow("account changed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("cleanup reuses the verified token across all batches and stops on failed jobs", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ claimed: 20, failed: 0 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ claimed: 20, failed: 1 }) });
  await processSupabaseMediaCleanup();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.every(([, options]) => options.headers.authorization === "Bearer fixture-token-a")).toBe(true);
});
test("missing/revoked sessions cannot upload or delete, and external image URLs are untouched", async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  await expect(uploadSupabaseAvatar(file)).rejects.toThrow("signed in");
  await expect(deleteSupabaseImage("usr/user-a/fixture.jpg")).rejects.toThrow("signed in");
  await deleteSupabaseImage("https://provider.example.test/avatar.jpg");
  expect(fetchMock).not.toHaveBeenCalled();
});
test("remote media requests abort after the deadline and release their timer", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fixture-aborted")));
    }));
    const result = expect(deleteSupabaseImage("usr/user-a/fixture.jpg")).rejects.toThrow("fixture-aborted");
    await jest.advanceTimersByTimeAsync(30_000);
    await result;
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
