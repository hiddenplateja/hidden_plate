import { createSupabaseTestScreenServices, SUPABASE_SCREEN_SERVICES } from "@/services/supabaseTestScreenServices";
jest.mock("@/services/supabase", () => { throw new Error("No SDK initialization during registry construction"); });
jest.mock("@/services/supabaseUsers", () => ({ getSupabaseUsersByIds: jest.fn(), getSupabaseUserById: jest.fn(), listSupabaseUsers: jest.fn(),
  setSupabaseUserBanned: jest.fn(), updateMySupabaseProfile: jest.fn(), searchSupabaseUsers: jest.fn(), getSupabaseSuggestedUsers: jest.fn() }));
let original: NodeJS.ProcessEnv;
beforeEach(() => { original = { ...process.env };
  process.env.EXPO_PUBLIC_BACKEND = "supabase"; process.env.EXPO_PUBLIC_BACKEND_TEST_MODE = "true";
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://project.supabase.co"; process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = "https://media.example.test";
});
afterEach(() => { process.env = original; });
test("one lazy typed registry lists all 28 non-payment screen groups without loading SDKs", () => {
  const services = createSupabaseTestScreenServices("preview");
  expect(services.services).toHaveLength(28); expect(Object.isFrozen(services)).toBe(true);
  expect(SUPABASE_SCREEN_SERVICES.some(service => /payment|purchase|checkout/i.test(service))).toBe(false);
});
test("concurrent port loads share a promise and preserve legacy function names", async () => {
  const services = createSupabaseTestScreenServices("preview"), request = services.load("users");
  expect(services.load("users")).toBe(request);
  expect(typeof (await request).updateMyProfile).toBe("function");
});
test("load failures are retryable without falling back to Appwrite", async () => {
  const services = createSupabaseTestScreenServices("preview"), first = services.load("auth");
  await expect(first).rejects.toThrow("No SDK initialization");
  const second = services.load("auth"); expect(second).not.toBe(first);
  await expect(second).rejects.toThrow("No SDK initialization");
});
test("production, unknown and payment service requests fail closed", async () => {
  expect(() => createSupabaseTestScreenServices("production")).toThrow("production");
  const services = createSupabaseTestScreenServices("preview");
  for (const key of ["payments", "toString", "__proto__"]) await expect(services.load(key as "auth")).rejects.toThrow("Unknown non-payment");
});
