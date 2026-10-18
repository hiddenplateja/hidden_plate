export class SupabaseAuthError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "SupabaseAuthError";
  }
}

export function throwSupabaseAuthError(error: { message: string; code?: string } | null, fallback: string): void {
  if (error) throw new SupabaseAuthError(error.message || fallback, error.code);
}
