// src/utils/passwordPolicy.ts
// Shared policy for any NEWLY SET password: signup, in-app change, and reset.
//
// IMPORTANT — keep these rules and the common-password list in sync with the
// worker's copy in worker/src/index.ts (validatePassword). The worker is the
// real boundary for the reset flow (no session there); this client copy gives
// immediate inline feedback and covers signup + in-app change, where the write
// goes straight to Appwrite and only its weaker built-in minimum applies.
//
// NOT used for the login form — that must accept whatever password a user
// already has, including ones predating this policy.

export const PASSWORD_MIN_LENGTH = 10;

// Low-value, high-frequency passwords worth blocking outright. The length rule
// already rejects most classic weak ones (e.g. "password", "qwerty"); this list
// targets the ones long enough to slip past it.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd123",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "qwerty12345",
  "iloveyou123",
  "welcome123",
  "letmein123",
  "admin12345",
  "changeme123",
  "hiddenplate",
  "0000000000",
  "1111111111",
]);

/**
 * Validate a new password against the policy. Returns a short, user-facing
 * error message suitable for an inline field error, or `null` when acceptable.
 */
export function validateNewPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `At least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (/^\d+$/.test(password)) {
    return "Don't use only numbers";
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common";
  }
  return null;
}
