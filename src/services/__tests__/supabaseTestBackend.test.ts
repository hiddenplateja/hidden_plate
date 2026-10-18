import { createSupabaseTestBackend, SUPABASE_TEST_DOMAINS } from "@/services/supabaseTestBackend";

jest.mock("@/services/supabaseRestaurants", () => ({ listSupabaseRestaurants: jest.fn() }));
jest.mock("@/services/appwrite", () => { throw new Error("Appwrite must not load in the staged gateway"); });
jest.mock("@/services/supabase", () => { throw new Error("Gateway construction must not initialize Supabase"); });

let original: NodeJS.ProcessEnv;
beforeEach(() => {
  original = { ...process.env };
  process.env.EXPO_PUBLIC_BACKEND = "supabase";
  process.env.EXPO_PUBLIC_BACKEND_TEST_MODE = "true";
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = "https://media.example.test";
});
afterEach(() => { process.env = original; });

test("constructs without SDK initialization or native work", () => {
  const backend = createSupabaseTestBackend("preview");
  expect(backend.configuration.backend).toBe("supabase");
  expect(backend.domains).toHaveLength(30);
  expect(Object.isFrozen(backend)).toBe(true);
});
test("loads only the requested domain with its typed staged contract", async () => {
  const backend = createSupabaseTestBackend("preview");
  const first = backend.load("restaurants");
  expect(backend.load("restaurants")).toBe(first);
  expect(typeof (await first).listSupabaseRestaurants).toBe("function");
});
test("failed module loading is not permanently cached", async () => {
  const backend = createSupabaseTestBackend("preview");
  const first = backend.load("auth");
  await expect(first).rejects.toThrow("must not initialize Supabase");
  const retry = backend.load("auth"); expect(retry).not.toBe(first);
  await expect(retry).rejects.toThrow("must not initialize Supabase");
});
test("payment modules and prototype keys cannot be requested", async () => {
  const backend = createSupabaseTestBackend("preview");
  expect(SUPABASE_TEST_DOMAINS.some(domain => /payment|purchase|checkout/i.test(domain))).toBe(false);
  // Untyped JS callers receive an explicit failure, not a fallback backend.
  for (const domain of ["payments", "checkout", "toString", "__proto__"]) {
    await expect(backend.load(domain as "auth")).rejects.toThrow("Unknown non-payment");
  }
});
test("production rejects test mode, while normal mode supports the default backend", () => {
  expect(() => createSupabaseTestBackend("production")).toThrow("production");
  delete process.env.EXPO_PUBLIC_BACKEND_TEST_MODE;
  expect(() => createSupabaseTestBackend("preview")).not.toThrow();
  expect(() => createSupabaseTestBackend("production")).not.toThrow();
});
