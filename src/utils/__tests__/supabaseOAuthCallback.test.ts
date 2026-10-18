import { readSupabaseOAuthCode } from "@/utils/supabaseOAuthCallback";

test("accepts an exact callback with one PKCE code", () => {
  expect(readSupabaseOAuthCode("hiddenplate://auth?code=valid-code")).toBe("valid-code");
});
test.each([
  "https://attacker.example/auth/callback?code=test",
  "hiddenplate://auth/wrong?code=test",
  "hiddenplate://auth?code=first&code=second",
  "hiddenplate://auth#access_token=secret",
  "hiddenplate://auth?error=access_denied&error_description=private-details",
])("rejects unsafe or unsuccessful callback %s", (url) => {
  expect(() => readSupabaseOAuthCode(url)).toThrow();
});
