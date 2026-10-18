// Shared backend configuration; Supabase is the default after device validation.
import { BACKEND_PUBLIC_CONFIGURATION } from "@/services/backendPublicConfiguration";
export type BackendBuild = "development" | "preview" | "production";
export type BackendName = "appwrite" | "supabase";
export type BackendTestEnvironment = {
  backend?: string;
  testMode?: string;
  supabaseUrl?: string;
  publishableKey?: string;
  mediaUrl?: string;
};

export class BackendConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "BackendConfigurationError"; }
}

// Coordinated integration passed the user's phone checklist. Production still
// rejects test mode, invalid origins, unknown build labels and server secrets.
export const SUPABASE_APP_INTEGRATION_READY = true;

export function readBackendTestEnvironment(): BackendTestEnvironment {
  // Expo requires literal environment access for build-time substitution.
  return {
    backend: process.env.EXPO_PUBLIC_BACKEND ?? "supabase",
    testMode: process.env.EXPO_PUBLIC_BACKEND_TEST_MODE ?? "false",
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? BACKEND_PUBLIC_CONFIGURATION.supabaseUrl,
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? BACKEND_PUBLIC_CONFIGURATION.publishableKey,
    mediaUrl: process.env.EXPO_PUBLIC_MEDIA_WORKER_URL ?? BACKEND_PUBLIC_CONFIGURATION.mediaUrl,
  };
}

function httpsOrigin(value: string | undefined, label: string): string {
  // Strict DNS-origin syntax avoids depending on RN's partial global URL
  // implementation before the selected SDK installs its URL polyfill.
  const match = /^https:\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?\/?$/.exec(value ?? "");
  const host = match?.[1].toLowerCase();
  const port = match?.[2] ? Number(match[2]) : 443;
  if (!host || host.length > 253 || !host.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) || port < 1 || port > 65535) {
    throw new BackendConfigurationError(`${label} must be an HTTPS DNS origin without credentials, a path or query.`);
  }
  return `https://${host}${port === 443 ? "" : `:${port}`}`;
}

function isPublicKey(raw: string | undefined): boolean {
  const key = raw?.trim() ?? "";
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // Legacy anon JWTs are public too. Decode ONLY to reject privileged key
  // types; this does not verify signatures or authenticate any request.
  const parts = key.split(".");
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bits = 0, count = 0, payload = "";
    for (const character of parts[1]) {
      bits = (bits << 6) | alphabet.indexOf(character);
      count += 6;
      if (count >= 8) { count -= 8; payload += String.fromCharCode((bits >> count) & 255); }
    }
    return JSON.parse(payload).role === "anon";
  } catch { return false; }
}

export function validateSupabaseTestConfiguration(build: BackendBuild, env: BackendTestEnvironment) {
  // Historical export name retained for the coordinated service registry.
  if (!["development", "preview", "production"].includes(build)) throw new BackendConfigurationError("Supabase is not enabled for unknown builds.");
  if (build === "production" && env.testMode !== "false") throw new BackendConfigurationError("Supabase production builds must disable test mode.");
  if (env.backend !== "supabase" || (env.testMode !== "true" && env.testMode !== "false")) {
    throw new BackendConfigurationError("Supabase requires an explicit true/false test-only opt-in setting.");
  }
  const projectOrigin = httpsOrigin(env.supabaseUrl, "Supabase URL");
  const mediaOrigin = httpsOrigin(env.mediaUrl, "Media Worker URL");
  if (!isPublicKey(env.publishableKey)) {
    throw new BackendConfigurationError("A public Supabase publishable/anon key is required; never use a server secret.");
  }
  // No credentials in namespace/loggable configuration. RLS remains authoritative.
  return Object.freeze({ backend: "supabase" as const, projectOrigin, mediaOrigin,
    cacheNamespace: `hidden-plate:supabase:${encodeURIComponent(projectOrigin)}` });
}

/** Supabase by default; Appwrite is an explicit legacy fallback only. */
export function resolveAppBackend(build: BackendBuild, env = readBackendTestEnvironment()): BackendName {
  if (env.backend === "appwrite") return "appwrite";
  const backend = env.backend ?? "supabase";
  if (backend !== "supabase") throw new BackendConfigurationError("Unknown backend selection.");
  validateSupabaseTestConfiguration(build, { ...env, backend });
  if (!SUPABASE_APP_INTEGRATION_READY) {
    throw new BackendConfigurationError("Supabase app wiring is incomplete. Keep Appwrite selected until coordinated integration is ready.");
  }
  return "supabase";
}
