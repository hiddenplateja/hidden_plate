import { validateNewPassword } from "@/utils/passwordPolicy";

export function normalizeAuthEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  return normalized;
}

export function validateAuthCode(code: string): string {
  const token = code.trim();
  if (!/^\d{6}$/.test(token)) throw new Error("Enter the 6-digit code we emailed you.");
  return token;
}

export function validateAuthProfile(username: string, displayName: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedName = displayName.trim();
  if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) throw new Error("Username must be 3–20 lowercase letters, numbers or underscores.");
  if (normalizedName.length < 2 || normalizedName.length > 50) throw new Error("Name must contain 2–50 characters.");
  return { username: normalizedUsername, displayName: normalizedName };
}

export function assertNewAuthPassword(password: string): void {
  const error = validateNewPassword(password);
  if (error) throw new Error(error);
}
