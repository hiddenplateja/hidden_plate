import { resolveAppBackend, validateSupabaseTestConfiguration, type BackendTestEnvironment } from "@/services/backendTestConfiguration";

const config: BackendTestEnvironment = { backend: "supabase", testMode: "true",
  supabaseUrl: "https://project.supabase.co", mediaUrl: "https://media.example.test", publishableKey: "sb_publishable_test_key" };
const legacyKey = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

test.each(["development", "preview", "production"] as const)("%s permits only an explicit Appwrite fallback", build => {
  expect(() => resolveAppBackend(build, {})).toThrow();
  expect(resolveAppBackend(build, { ...config, backend: "appwrite" })).toBe("appwrite");
});
test("Supabase is the default selection with validated configuration", () => {
  expect(resolveAppBackend("preview", { ...config, backend: undefined })).toBe("supabase");
});
test("unknown or misspelled backend fails closed", () => {
  expect(() => resolveAppBackend("preview", { ...config, backend: "supbase" })).toThrow("Unknown backend");
});
test.each([undefined, "TRUE", "1"])("requires exact mode setting (%s)", testMode => {
  expect(() => validateSupabaseTestConfiguration("preview", { ...config, testMode })).toThrow("test-only opt-in");
});
test("production rejects the test gateway even with configured keys and flags", () => {
  expect(() => validateSupabaseTestConfiguration("production", config)).toThrow("production");
});
test.each(["development", "preview"] as const)("%s permits the coordinated test integration only with complete opt-in", build => {
  expect(resolveAppBackend(build, config)).toBe("supabase");
  expect(() => resolveAppBackend(build, { ...config, testMode: undefined })).toThrow("test-only opt-in");
  expect(() => resolveAppBackend(build, { ...config, publishableKey: undefined })).toThrow("public Supabase");
});
test("the application selector itself rejects production Supabase opt-in", () => {
  expect(() => resolveAppBackend("production", config)).toThrow("production");
});
test.each(["development", "preview", "production"] as const)("%s supports validated normal-mode Supabase", build => {
  expect(resolveAppBackend(build, { ...config, testMode: "false" })).toBe("supabase");
  expect(() => resolveAppBackend(build, { ...config, testMode: "false", publishableKey: "sb_secret_forbidden" })).toThrow("public Supabase");
});
test.each(["http://example.test", "https://user:password@example.test", "https://example.test/media", "https://example.test?token=x", "https://example.test/#x", "https://example.test:99999", "https://-bad.example.test", "https://example..test", "https://example test", "https://example.test\\evil", "invalid", undefined])("rejects unsafe media origin %s", mediaUrl => {
  expect(() => validateSupabaseTestConfiguration("preview", { ...config, mediaUrl })).toThrow("HTTPS DNS origin");
});
test("origin canonicalization works without the native/global URL implementation", () => {
  const resolved = validateSupabaseTestConfiguration("preview", { ...config, supabaseUrl: "https://PROJECT.supabase.co:443/" });
  expect(resolved.projectOrigin).toBe("https://project.supabase.co");
});
test("untyped unknown build labels cannot bypass the production guard", () => {
  expect(() => validateSupabaseTestConfiguration("release" as "preview", config)).toThrow("unknown builds");
});
test.each(["sb_secret_test", "  sb_secret_test", legacyKey("service_role"), legacyKey("authenticated"), "invalid", "x.invalid.y", undefined])("rejects privileged/malformed/missing key", publishableKey => {
  expect(() => validateSupabaseTestConfiguration("preview", { ...config, publishableKey })).toThrow("public Supabase");
});
test("allows legacy anon keys without exposing them in the cache namespace", () => {
  const publicKey = legacyKey("anon");
  const resolved = validateSupabaseTestConfiguration("preview", { ...config, publishableKey: publicKey });
  expect(resolved.projectOrigin).toBe(config.supabaseUrl);
  expect(JSON.stringify(resolved)).not.toContain(publicKey);
  expect(Object.isFrozen(resolved)).toBe(true);
});
test("different Supabase projects cannot share a cache namespace", () => {
  const first = validateSupabaseTestConfiguration("preview", config);
  const second = validateSupabaseTestConfiguration("preview", { ...config, supabaseUrl: "https://other.supabase.co/" });
  expect(first.cacheNamespace).not.toBe(second.cacheNamespace);
});
