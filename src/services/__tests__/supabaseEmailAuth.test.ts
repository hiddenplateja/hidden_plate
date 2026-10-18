import { createIsolatedSupabaseAuthClient, supabase } from "@/services/supabase";
import { cancelSupabaseEmailSignup, changeSupabasePassword, completeSupabaseEmailSignup,
  requestSupabasePasswordReset, resetSupabasePassword, sendSupabaseEmailOtp, verifySupabaseEmailOtp } from "@/services/supabaseEmailAuth";

jest.mock("@/services/supabase", () => ({ createIsolatedSupabaseAuthClient: jest.fn(),
  supabase: { auth: { setSession: jest.fn(), updateUser: jest.fn(), getUser: jest.fn(), getSession: jest.fn() } },
}));

const user = { id: "user-a", email: "new@example.test", email_confirmed_at: "2026-10-06" };
const session = { access_token: "test-access", refresh_token: "test-refresh" };
const input = { email: " NEW@Example.test ", password: "  NotCommonPassword  ", username: " Foodie ", displayName: " Foodie Name " };
let client: { auth: Record<string, jest.Mock>; from: jest.Mock; rpc: jest.Mock };
let pending: jest.Mock;
beforeEach(async () => {
  // Clear module-held proof using its old mocked client before resetting mocks.
  await cancelSupabaseEmailSignup();
  jest.resetAllMocks();
  pending = jest.fn().mockResolvedValue({ data: { user_id: user.id }, error: null });
  client = { auth: { signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
    verifyOtp: jest.fn().mockResolvedValue({ data: { session, user }, error: null }),
    getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }),
    getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    updateUser: jest.fn().mockResolvedValue({ error: null }), signOut: jest.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
    signInWithPassword: jest.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: pending }) }) }),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  };
  (createIsolatedSupabaseAuthClient as jest.Mock).mockReturnValue(client);
  (supabase.auth.setSession as jest.Mock).mockResolvedValue({ error: null });
  (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ error: null });
  (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user }, error: null });
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user } }, error: null });
});

test("email step requests an OTP without starting the main app session", async () => {
  await sendSupabaseEmailOtp(input.email);
  expect(client.auth.signInWithOtp).toHaveBeenCalledWith({ email: "new@example.test", options: { shouldCreateUser: true } });
  expect(supabase.auth.setSession).not.toHaveBeenCalled();
});
test("OTP proof stays isolated until password and profile completion succeed", async () => {
  await verifySupabaseEmailOtp(input.email, "123456");
  expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: "new@example.test", token: "123456", type: "email" });
  expect(supabase.auth.setSession).not.toHaveBeenCalled();
  await completeSupabaseEmailSignup(input);
  expect(client.auth.updateUser).toHaveBeenCalledWith({ password: input.password });
  expect(client.rpc).toHaveBeenCalledWith("finish_auth_signup", { chosen_username: "foodie", chosen_display_name: "Foodie Name", chosen_avatar: null });
  expect(supabase.auth.setSession).toHaveBeenCalledWith(session);
  expect(client.auth.signOut).not.toHaveBeenCalled();
});
test("a completed account cannot use signup to overwrite its password", async () => {
  pending.mockResolvedValue({ data: null, error: null });
  await expect(verifySupabaseEmailOtp(input.email, "123456")).rejects.toMatchObject({ code: "account_exists" });
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});
test("signup requires proof for the same verified email", async () => {
  await verifySupabaseEmailOtp(input.email, "123456");
  await expect(completeSupabaseEmailSignup({ ...input, email: "different@example.test" })).rejects.toMatchObject({ code: "verification_required" });
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});
test("profile failure never publishes the provisional session", async () => {
  await verifySupabaseEmailOtp(input.email, "123456");
  client.rpc.mockResolvedValue({ error: { message: "That username is already taken." } });
  await expect(completeSupabaseEmailSignup(input)).rejects.toThrow("username");
  expect(supabase.auth.setSession).not.toHaveBeenCalled();
});
test("cancelling proof requires another verification", async () => {
  await verifySupabaseEmailOtp(input.email, "123456");
  await cancelSupabaseEmailSignup();
  await expect(completeSupabaseEmailSignup(input)).rejects.toMatchObject({ code: "verification_required" });
});
test("invalid code and weak password fail before OTP verification", async () => {
  await expect(resetSupabasePassword(input.email, "12345678", input.password)).rejects.toThrow("6-digit");
  await expect(resetSupabasePassword(input.email, "123456", "password123")).rejects.toThrow("common");
  expect(client.auth.verifyOtp).not.toHaveBeenCalled();
});
test("reset request uses Supabase's anti-enumeration recovery endpoint", async () => {
  await requestSupabasePasswordReset(input.email);
  expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith("new@example.test");
});
test("reset verifies recovery OTP, updates password, and revokes only isolated session", async () => {
  await resetSupabasePassword(input.email, "123456", input.password);
  expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: "new@example.test", token: "123456", type: "recovery" });
  expect(client.auth.updateUser).toHaveBeenCalledWith({ password: input.password });
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(supabase.auth.setSession).not.toHaveBeenCalled();
});
test("bad recovery code cannot set a password and still cleans up", async () => {
  client.auth.verifyOtp.mockResolvedValue({ data: {}, error: { message: "Expired code" } });
  await expect(resetSupabasePassword(input.email, "123456", input.password)).rejects.toThrow("Expired");
  expect(client.auth.updateUser).not.toHaveBeenCalled();
  expect(client.auth.signOut).toHaveBeenCalled();
});
test("in-app password change sends the exact old password to Supabase for verification", async () => {
  await changeSupabasePassword(" exact Old Password ", input.password);
  expect(client.auth.updateUser).toHaveBeenCalledWith({ password: input.password, current_password: " exact Old Password " });
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(supabase.auth.setSession).toHaveBeenCalledWith(session);
  expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: " exact Old Password " });
});
test("wrong current password cannot perform a password change", async () => {
  client.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: "invalid_credentials" } });
  await expect(changeSupabasePassword("wrong", input.password)).rejects.toThrow("Current password");
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});
test("account switching during current-password verification cannot change the new account", async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: "user-b" } } } });
  await expect(changeSupabasePassword("old", input.password)).rejects.toThrow("account changed");
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});
