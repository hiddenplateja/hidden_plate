// Preserve the existing UI validation messages without importing a backend SDK.
export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Display name is required";
  if (trimmed.length < 2) return "At least 2 characters";
  if (trimmed.length > 50) return "At most 50 characters";
  return null;
}
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export function validateUsername(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "Username is required";
  if (!USERNAME_RE.test(trimmed)) return "3–20 chars: lowercase letters, numbers, underscore";
  return null;
}
export function validateBio(value: string): string | null {
  if (value.length > 280) return "Bio must be 280 characters or less";
  return null;
}
