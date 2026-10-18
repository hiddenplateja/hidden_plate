import type * as Auth from "@/services/auth";
import type * as Push from "@/services/pushTokens";
import type { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
type Gateway = ReturnType<typeof createSupabaseTestBackend>;

export async function loadSupabaseAuthScreenPort(gateway: Gateway) {
  const [auth, email, oauth] = await Promise.all([gateway.load("auth"), gateway.load("emailAuth"), gateway.load("oauth")]);
  return Object.freeze({ login: auth.loginWithSupabase, signup: auth.signupWithSupabase, logout: auth.logoutFromSupabase,
    getCurrentUser: auth.getSupabaseCurrentUser, emailVerificationEnabled: () => true, passwordResetEnabled: () => true,
    sendEmailOtp: email.sendSupabaseEmailOtp, verifyEmailOtp: email.verifySupabaseEmailOtp,
    confirmEmailVerified: auth.confirmSupabaseEmailVerified, requestPasswordReset: email.requestSupabasePasswordReset,
    resetPassword: email.resetSupabasePassword, changePassword: email.changeSupabasePassword,
    loginWithGoogle: oauth.loginWithSupabaseGoogle, loginWithApple: oauth.loginWithSupabaseApple,
    completeOAuthSignup: oauth.completeSupabaseOAuthSignup,
  } satisfies Omit<typeof Auth, "AuthError">);
}
export async function loadSupabasePushScreenPort(gateway: Gateway) {
  const [push, session] = await Promise.all([gateway.load("pushTokens"), import("@/services/supabasePinnedSession")]);
  return Object.freeze({
    registerForPushNotifications: (userId: string) => push.registerForSupabasePushNotifications(userId),
    clearPushTokensForUser: async (userId?: string) => {
      const expected = await session.currentSupabaseSessionIdentity().catch(() => null);
      if (!expected || (userId !== undefined && userId !== expected.userId)) return;
      // Snapshot cleanup credentials now; never adopt a later queued account.
      await push.clearCurrentSupabasePushToken(expected).catch(() => {});
    },
  } satisfies Omit<typeof Push, "PushTokenError">);
}
