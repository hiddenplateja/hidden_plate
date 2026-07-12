// worker/test/index.spec.ts
// Unit tests for the Hidden Plate payments / OTP worker.
//
// Style: we call the exported `worker.fetch(request, env)` directly (unit style)
// with a hand-built `env`, so we fully control the rate-limit bindings and the
// var values without depending on wrangler/secret state or the test pool wiring
// up the `ratelimits` namespaces. Outbound HTTP (Appwrite REST + Resend) is
// stubbed by replacing the global `fetch` — the worker calls bare `fetch()`
// helpers, so the stub intercepts every outbound call.

import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/index";

// Constructor cast that yields a correctly-typed `Request` for the worker.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// ── Test env ─────────────────────────────────────────────────────────
// A complete Env with mock rate limiters. `allow: false` forces the 429 path;
// `webhookAuth` sets the RevenueCat shared secret used by the webhook route.
function makeEnv(opts: { allow?: boolean; webhookAuth?: string } = {}): Env {
  const allow = opts.allow ?? true;
  const limiter = {
    limit: async () => ({ success: allow }),
  } as unknown as RateLimit;
  return {
    APPWRITE_ENDPOINT: "https://appwrite.test/v1",
    APPWRITE_PROJECT_ID: "test-project",
    APPWRITE_DATABASE_ID: "test-db",
    RESTAURANTS_COLLECTION_ID: "restaurants",
    APP_CONFIG_COLLECTION_ID: "app_config",
    FEATURE_PURCHASES_COLLECTION_ID: "feature_purchases",
    EMAIL_OTPS_COLLECTION_ID: "email_otps",
    RESEND_FROM: "Hidden Plate <verify@test.dev>",
    OTP_TTL_MINUTES: "10",
    APPWRITE_API_KEY: "test-api-key",
    REVENUECAT_WEBHOOK_AUTH: opts.webhookAuth ?? "test-webhook-secret",
    RESEND_API_KEY: "test-resend-key",
    RL_EMAIL_SEND: limiter,
    RL_EMAIL_VERIFY: limiter,
    RL_EMAIL_CONFIRM: limiter,
    RL_RESTAURANT_SUBMIT: limiter,
  };
}

// ── Outbound fetch stub ──────────────────────────────────────────────
// Routes the worker's Appwrite REST + Resend calls to canned responses so the
// handlers run end-to-end without real network. Returns the mock so a test can
// assert which endpoints were (or weren't) hit.
interface FetchScenario {
  /** isEmailRegistered / getUserByEmail -> GET /users?queries -> { total, users } */
  userTotal?: number;
  /** Explicit user record returned by GET /users? (overrides the userTotal default). */
  user?: Record<string, unknown> | null;
  /** GET .../documents/<id> -> the existing OTP doc, or null for "not found". */
  existingOtp?: Record<string, unknown> | null;
  /** GET /account (JWT-authed) -> the resolved account, or null to reject with 401. */
  account?: Record<string, unknown> | null;
}
function installFetch(scenario: FetchScenario = {}) {
  const { userTotal = 0, existingOtp = null, user, account } = scenario;
  // GET /users? returns both `total` (isEmailRegistered) and `users[0]`
  // (getUserByEmail). Default a stub user in when the email "exists".
  const usersArr =
    user !== undefined
      ? user
        ? [user]
        : []
      : userTotal > 0
        ? [{ $id: "user_test", email: "user@example.com", emailVerification: false }]
        : [];
  const mock = vi.fn(async (input: unknown, init?: { method?: string }) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    // Resend email send.
    if (url.startsWith("https://api.resend.com/emails")) {
      return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
    }
    // Appwrite get account (JWT-authed). Present only when a test opts in.
    if (method === "GET" && /\/account$/.test(url)) {
      return account
        ? new Response(JSON.stringify(account), { status: 200 })
        : new Response("unauthorized", { status: 401 });
    }
    // Appwrite admin Users list (email-already-registered + reset lookup).
    if (url.includes("/users?")) {
      return new Response(
        JSON.stringify({ total: userTotal, users: usersArr }),
        { status: 200 },
      );
    }
    // Appwrite admin set password / verification on a user.
    if (method === "PATCH" && /\/users\/[^/]+\/(password|verification)$/.test(url)) {
      return new Response(JSON.stringify({ $id: "user_test" }), { status: 200 });
    }
    // Appwrite get single document (cooldown / OTP lookup).
    if (method === "GET" && /\/documents\/[^/?]+$/.test(url)) {
      return existingOtp
        ? new Response(JSON.stringify(existingOtp), { status: 200 })
        : new Response("not found", { status: 404 });
    }
    // Appwrite create document.
    if (method === "POST" && /\/documents$/.test(url)) {
      return new Response(JSON.stringify({ $id: "doc_test" }), { status: 200 });
    }
    // Appwrite update document.
    if (method === "PATCH" && /\/documents\//.test(url)) {
      return new Response(JSON.stringify({ $id: "doc_test" }), { status: 200 });
    }
    // Appwrite delete document (OTP consume).
    if (method === "DELETE" && /\/documents\//.test(url)) {
      return new Response(null, { status: 204 });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

// Mirror of the worker's code-hash so a test can plant a matching OTP record.
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function calledPasswordUpdate(
  mock: ReturnType<typeof installFetch>,
): boolean {
  return mock.mock.calls.some(
    ([u, init]) =>
      /\/users\/[^/]+\/password$/.test(String(u)) &&
      ((init as { method?: string })?.method ?? "").toUpperCase() === "PATCH",
  );
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new IncomingRequest(`https://worker.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function calledResend(mock: ReturnType<typeof installFetch>): boolean {
  return mock.mock.calls.some(([u]) =>
    String(u).startsWith("https://api.resend.com/emails"),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routing", () => {
  it("GET / -> 200 health text", async () => {
    const res = await worker.fetch(
      new IncomingRequest("https://worker.test/"),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hidden-plate-pay ok");
  });

  it("GET /health -> 200 health text", async () => {
    const res = await worker.fetch(
      new IncomingRequest("https://worker.test/health"),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hidden-plate-pay ok");
  });

  it("unknown path -> 404", async () => {
    const res = await worker.fetch(
      new IncomingRequest("https://worker.test/nope"),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });
});

describe("/email/send", () => {
  it("rejects an invalid email with 400 and never calls out", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/send", { email: "not-an-email" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a code for a valid new email -> 200 { ok: true }", async () => {
    const fetchMock = installFetch({ userTotal: 0, existingOtp: null });
    const res = await worker.fetch(
      post("/email/send", { email: "new.user@example.com" }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calledResend(fetchMock)).toBe(true);
  });

  it("blocks signup for an already-registered email -> 409", async () => {
    const fetchMock = installFetch({ userTotal: 1 });
    const res = await worker.fetch(
      post("/email/send", { email: "taken@example.com" }),
      makeEnv(),
    );
    expect(res.status).toBe(409);
    // Never reaches the send step.
    expect(calledResend(fetchMock)).toBe(false);
  });

  it("enforces the per-email resend cooldown -> 429", async () => {
    // An OTP doc created 5s ago is inside the 30s cooldown window.
    const fetchMock = installFetch({
      userTotal: 0,
      existingOtp: { createdAt: new Date(Date.now() - 5_000).toISOString() },
    });
    const res = await worker.fetch(
      post("/email/send", { email: "new.user@example.com" }),
      makeEnv(),
    );
    expect(res.status).toBe(429);
    expect(calledResend(fetchMock)).toBe(false);
  });

  it("returns 429 when the per-IP limiter is exhausted", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/send", { email: "new.user@example.com" }),
      makeEnv({ allow: false }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ message: expect.any(String) });
    // Rate-limited before any outbound work (and before parsing the body).
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/email/verify", () => {
  it("rejects a malformed code with 400", async () => {
    installFetch();
    const res = await worker.fetch(
      post("/email/verify", { email: "a@b.com", code: "12" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 when the per-IP limiter is exhausted", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/verify", { email: "a@b.com", code: "123456" }),
      makeEnv({ allow: false }),
    );
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/email/reset-send", () => {
  it("rejects an invalid email with 400 and never calls out", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/reset-send", { email: "nope" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a neutral 200 when no account exists, and never emails (anti-enumeration)", async () => {
    const fetchMock = installFetch({ userTotal: 0 });
    const res = await worker.fetch(
      post("/email/reset-send", { email: "ghost@example.com" }),
      makeEnv(),
    );
    // Same response an existing account gets — no existence oracle.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calledResend(fetchMock)).toBe(false);
  });

  it("sends a reset code for an existing account -> 200 { ok: true }", async () => {
    const fetchMock = installFetch({ userTotal: 1, existingOtp: null });
    const res = await worker.fetch(
      post("/email/reset-send", { email: "user@example.com" }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calledResend(fetchMock)).toBe(true);
  });

  it("enforces the per-email resend cooldown -> 429", async () => {
    const fetchMock = installFetch({
      userTotal: 1,
      existingOtp: { createdAt: new Date(Date.now() - 5_000).toISOString() },
    });
    const res = await worker.fetch(
      post("/email/reset-send", { email: "user@example.com" }),
      makeEnv(),
    );
    expect(res.status).toBe(429);
    expect(calledResend(fetchMock)).toBe(false);
  });

  it("returns 429 when the per-IP limiter is exhausted", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/reset-send", { email: "user@example.com" }),
      makeEnv({ allow: false }),
    );
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/email/reset", () => {
  it("rejects a malformed code with 400", async () => {
    installFetch();
    const res = await worker.fetch(
      post("/email/reset", { email: "a@b.com", code: "12", password: "longenough" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a too-short password with 400", async () => {
    installFetch();
    const res = await worker.fetch(
      post("/email/reset", { email: "a@b.com", code: "123456", password: "short" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an all-numeric password with 400 and never sets a password", async () => {
    const fetchMock = installFetch({ userTotal: 1 });
    const res = await worker.fetch(
      post("/email/reset", {
        email: "user@example.com",
        code: "123456",
        password: "1234567890",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(calledPasswordUpdate(fetchMock)).toBe(false);
  });

  it("rejects a common password with 400 and never sets a password", async () => {
    const fetchMock = installFetch({ userTotal: 1 });
    const res = await worker.fetch(
      post("/email/reset", {
        email: "user@example.com",
        code: "123456",
        password: "password123",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(calledPasswordUpdate(fetchMock)).toBe(false);
  });

  it("rejects an incorrect code with 400 and never sets a password", async () => {
    const fetchMock = installFetch({
      userTotal: 1,
      existingOtp: {
        codeHash: "deadbeef",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        attempts: 0,
      },
    });
    const res = await worker.fetch(
      post("/email/reset", {
        email: "user@example.com",
        code: "123456",
        password: "longenough",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(calledPasswordUpdate(fetchMock)).toBe(false);
  });

  it("sets the new password for a correct code -> 200 { ok: true }", async () => {
    const email = "user@example.com";
    const code = "123456";
    const fetchMock = installFetch({
      userTotal: 1,
      existingOtp: {
        codeHash: await sha256Hex(`${code}:${email}`),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        attempts: 0,
      },
    });
    const res = await worker.fetch(
      post("/email/reset", { email, code, password: "brandnewpass" }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calledPasswordUpdate(fetchMock)).toBe(true);
  });

  it("returns 429 when the per-IP limiter is exhausted", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/reset", {
        email: "user@example.com",
        code: "123456",
        password: "longenough",
      }),
      makeEnv({ allow: false }),
    );
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/email/password-changed", () => {
  it("rejects a request with no JWT -> 401 and never emails", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/email/password-changed", {}),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(calledResend(fetchMock)).toBe(false);
  });

  it("rejects an invalid/expired JWT -> 401 and never emails", async () => {
    const fetchMock = installFetch({ account: null });
    const res = await worker.fetch(
      post("/email/password-changed", { jwt: "bad" }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(calledResend(fetchMock)).toBe(false);
  });

  it("emails the account's OWN address (from the JWT) -> 200 { ok: true }", async () => {
    const fetchMock = installFetch({
      account: { $id: "u1", email: "owner@example.com" },
    });
    const res = await worker.fetch(
      post("/email/password-changed", { jwt: "good" }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calledResend(fetchMock)).toBe(true);
    // The recipient is the JWT-resolved address, never a body-supplied one.
    const resendCall = fetchMock.mock.calls.find(([u]) =>
      String(u).startsWith("https://api.resend.com/emails"),
    );
    const sentBody = JSON.parse(
      String((resendCall?.[1] as { body?: string })?.body ?? "{}"),
    );
    expect(sentBody.to).toEqual(["owner@example.com"]);
  });

  it("returns 429 when the per-IP limiter is exhausted", async () => {
    const fetchMock = installFetch({ account: { $id: "u1", email: "o@e.com" } });
    const res = await worker.fetch(
      post("/email/password-changed", { jwt: "good" }),
      makeEnv({ allow: false }),
    );
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/restaurant/submit", () => {
  it("rejects a request with no JWT -> 401", async () => {
    const fetchMock = installFetch();
    const res = await worker.fetch(
      post("/restaurant/submit", { data: { name: "Testers" } }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-IP limiter is exhausted (before any work)", async () => {
    const fetchMock = installFetch({ account: { $id: "u1", email: "o@e.com" } });
    const res = await worker.fetch(
      post("/restaurant/submit", {
        jwt: "good",
        data: {
          name: "Scotchies",
          address: "1 Beach Rd",
          parish: "St. James",
          latitude: 18.5,
          longitude: -77.9,
        },
      }),
      makeEnv({ allow: false }),
    );
    expect(res.status).toBe(429);
    // Rate-limited before JWT verification or any Appwrite call.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/revenuecat/webhook", () => {
  it("rejects a missing Authorization header with 401", async () => {
    const res = await worker.fetch(
      post("/revenuecat/webhook", {}),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong Authorization header with 401", async () => {
    const res = await worker.fetch(
      post("/revenuecat/webhook", {}, { authorization: "Bearer wrong" }),
      makeEnv({ webhookAuth: "right-secret" }),
    );
    expect(res.status).toBe(401);
  });
});
