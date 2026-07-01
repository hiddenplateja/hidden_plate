// worker/src/index.ts
// Hidden Plate — featured-placement fulfillment (RevenueCat webhook).
//
// This Worker is the ONLY trusted writer of `isFeatured` / `featuredUntil` on a
// restaurant. The app can't set those directly (Appwrite has no field-level
// permissions), so fulfillment happens here, triggered by RevenueCat's
// server-to-server webhook after a real in-app purchase:
//
//   App                         RevenueCat              Worker
//   ───                         ──────────              ──────
//   purchasePackage(feature_30d) → Store charge
//     (tags feature_restaurant_id)  → POST /revenuecat/webhook
//                                       check shared-secret auth header
//                                       map product_id → days (app_config)
//                                       verify restaurant.ownerId === buyer
//                                       set isFeatured + featuredUntil
//                                       write ledger row (idempotent on event id)
//
// The client never grants the feature — it only initiates the purchase. Even a
// tampered client can at most feature a restaurant it actually owns, after a
// real (RevenueCat-verified) purchase.

export interface Env {
	// vars (wrangler.jsonc)
	APPWRITE_ENDPOINT: string;
	APPWRITE_PROJECT_ID: string;
	APPWRITE_DATABASE_ID: string;
	RESTAURANTS_COLLECTION_ID: string;
	APP_CONFIG_COLLECTION_ID: string;
	FEATURE_PURCHASES_COLLECTION_ID: string;
	// Email verification (OTP via Resend)
	EMAIL_OTPS_COLLECTION_ID: string;
	RESEND_FROM: string; // e.g. "Hidden Plate <verify@yourdomain.com>"
	OTP_TTL_MINUTES: string; // e.g. "10"
	// secrets (wrangler secret put / .dev.vars)
	APPWRITE_API_KEY: string;
	// The Authorization header value you set on the RevenueCat webhook.
	REVENUECAT_WEBHOOK_AUTH: string;
	RESEND_API_KEY: string;
	// Rate limiters (wrangler.jsonc `ratelimits`). Per-IP, per-minute caps on the
	// email/OTP endpoints. `RateLimit` is a built-in Workers runtime type.
	RL_EMAIL_SEND: RateLimit;
	RL_EMAIL_VERIFY: RateLimit;
	RL_EMAIL_CONFIRM: RateLimit;
}

type ProductKind = "feature" | "listing";

interface Plan {
	id: string;
	days: number;
	productId: string;
	kind: ProductKind;
}

// Mirror of the app's DEFAULT_FEATURE_PLANS / DEFAULT_LISTING_PLANS (subset) —
// used when app_config has no plans. Keep product ids in sync with the stores.
const DEFAULT_PLANS: Plan[] = [
	{ id: "7d", days: 7, productId: "feature_7d", kind: "feature" },
	{ id: "30d", days: 30, productId: "feature_30d", kind: "feature" },
	{ id: "1yr", days: 365, productId: "listing_1yr", kind: "listing" },
];

// ── Rate limiting ────────────────────────────────────────────────────
// Per-IP limiter for the email/OTP endpoints. The real client IP comes from
// Cloudflare's CF-Connecting-IP header (the socket address — not spoofable via
// the request body). Returns a 429 Response when the caller is over the limit
// for the current window, or null to let the request proceed.
async function enforceRateLimit(
	limiter: RateLimit,
	request: Request,
): Promise<Response | null> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const { success } = await limiter.limit({ key: ip });
	if (success) return null;
	return json({ message: "Too many requests — try again in a minute." }, 429);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (url.pathname === "/" || url.pathname === "/health") {
				return text("hidden-plate-pay ok");
			}
			if (url.pathname === "/revenuecat/webhook" && request.method === "POST") {
				return handleWebhook(request, env);
			}
			if (url.pathname === "/email/send" && request.method === "POST") {
				return handleSendOtp(request, env);
			}
			if (url.pathname === "/email/verify" && request.method === "POST") {
				return handleVerifyOtp(request, env);
			}
			if (url.pathname === "/email/confirm" && request.method === "POST") {
				return handleConfirmOtp(request, env);
			}
			if (url.pathname === "/email/reset-send" && request.method === "POST") {
				return handleResetSend(request, env);
			}
			if (url.pathname === "/email/reset" && request.method === "POST") {
				return handleResetPassword(request, env);
			}
			return text("Not found", 404);
		} catch (err) {
			console.error("worker error", err);
			return text("error", 500);
		}
	},
} satisfies ExportedHandler<Env>;

// ── /revenuecat/webhook ─────────────────────────────────────────────
// RevenueCat POSTs purchase events here. We only act on one-time (consumable)
// feature purchases. Always return 2xx for events we've handled or can't act on,
// so RevenueCat doesn't retry forever; non-2xx is reserved for transient errors.
async function handleWebhook(request: Request, env: Env): Promise<Response> {
	// 1) Authenticate: the shared secret you configured on the RC webhook.
	const auth = request.headers.get("authorization") ?? "";
	if (!env.REVENUECAT_WEBHOOK_AUTH || auth !== env.REVENUECAT_WEBHOOK_AUTH) {
		return text("unauthorized", 401);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return text("bad request", 400);
	}

	const event = body?.event;
	if (!event || typeof event !== "object") return text("ok");

	// RevenueCat sends a TEST event from the dashboard; acknowledge it.
	if (event.type === "TEST") return text("ok");
	// One-time consumable purchases only.
	if (event.type !== "NON_RENEWING_PURCHASE") return text("ok");

	const eventId: string | undefined = event.id;
	const appUserId: string | undefined = event.app_user_id;
	const productId: string | undefined = event.product_id;
	const transactionId: string | null = event.transaction_id ?? null;
	const store: string | null = event.store ?? null;
	const restaurantId: string | undefined =
		event.subscriber_attributes?.feature_restaurant_id?.value;

	if (!eventId || !appUserId || !productId || !restaurantId) {
		console.error("webhook: missing fields", {
			eventId,
			appUserId,
			productId,
			hasRestaurant: !!restaurantId,
		});
		return text("ok");
	}

	// 2) Idempotency: the ledger doc id is the RC event id (stable across retries).
	const existing = await appwriteGetDocument(
		env,
		env.FEATURE_PURCHASES_COLLECTION_ID,
		eventId,
	);
	if (existing && existing.status === "completed") return text("ok");

	// 3) Authoritative days + kind for this product (from app_config).
	const product = await resolveProduct(env, productId);
	if (!product) {
		console.error("webhook: unknown product", productId);
		return text("ok");
	}
	const { days, kind } = product;

	// 4) Verify the buyer owns the restaurant they tagged.
	const restaurant = await appwriteGetDocument(
		env,
		env.RESTAURANTS_COLLECTION_ID,
		restaurantId,
	);
	if (!restaurant) {
		console.error("webhook: restaurant not found", restaurantId);
		return text("ok");
	}
	if (restaurant.ownerId !== appUserId) {
		console.error("webhook: ownership mismatch", {
			restaurantId,
			owner: restaurant.ownerId,
			buyer: appUserId,
		});
		return text("ok");
	}

	// 5) Deterministic window — reused on retries so we never double-stack. New
	// purchases extend from the later of now / current expiry. Feature and
	// listing windows are independent fields on the restaurant.
	const currentUntil =
		kind === "feature"
			? (restaurant.featuredUntil as string | null | undefined)
			: (restaurant.listingPaidUntil as string | null | undefined);
	const until: string =
		(existing?.featuredUntil as string | undefined) ??
		new Date(windowBase(currentUntil) + days * 86_400_000).toISOString();

	if (!existing) {
		const created = await appwriteCreateDocument(
			env,
			env.FEATURE_PURCHASES_COLLECTION_ID,
			{
				restaurantId,
				userId: appUserId,
				productId,
				days,
				status: "pending",
				featuredUntil: until,
				transactionId,
				store,
				createdAt: new Date().toISOString(),
			},
			[`read("user:${appUserId}")`],
			eventId,
		);
		// A concurrent retry already created (and maybe completed) it.
		if (created === "conflict") {
			const now = await appwriteGetDocument(
				env,
				env.FEATURE_PURCHASES_COLLECTION_ID,
				eventId,
			);
			if (now?.status === "completed") return text("ok");
		}
	}

	// 6) Apply the grant to the right field, then complete the ledger row.
	//   feature → featured carousel/badge; listing → keeps the claimed listing
	//   visible in discovery.
	const patch =
		kind === "feature"
			? { isFeatured: true, featuredUntil: until }
			: { listingPaidUntil: until };
	await appwriteUpdateDocument(
		env,
		env.RESTAURANTS_COLLECTION_ID,
		restaurantId,
		patch,
	);
	await appwriteUpdateDocument(
		env,
		env.FEATURE_PURCHASES_COLLECTION_ID,
		eventId,
		{ status: "completed", completedAt: new Date().toISOString() },
	);

	return text("ok");
}

// Later of (now, existing future expiry) in epoch ms — so renewals stack.
function windowBase(currentUntil: string | null | undefined): number {
	const now = Date.now();
	if (!currentUntil) return now;
	const t = new Date(currentUntil).getTime();
	return Number.isFinite(t) && t > now ? t : now;
}

// ── Appwrite REST helpers (no SDK — plain fetch) ────────────────────
function dbBase(env: Env): string {
	return `${env.APPWRITE_ENDPOINT}/databases/${env.APPWRITE_DATABASE_ID}/collections`;
}
function serverHeaders(env: Env): Record<string, string> {
	return {
		"content-type": "application/json",
		"x-appwrite-project": env.APPWRITE_PROJECT_ID,
		"x-appwrite-key": env.APPWRITE_API_KEY,
	};
}

async function appwriteGetDocument(
	env: Env,
	collectionId: string,
	docId: string,
): Promise<Record<string, any> | null> {
	const res = await fetch(`${dbBase(env)}/${collectionId}/documents/${docId}`, {
		headers: serverHeaders(env),
	});
	if (!res.ok) return null;
	return (await res.json()) as Record<string, any>;
}

async function appwriteCreateDocument(
	env: Env,
	collectionId: string,
	data: Record<string, unknown>,
	permissions: string[],
	documentId = "unique()",
): Promise<Record<string, any> | "conflict"> {
	const res = await fetch(`${dbBase(env)}/${collectionId}/documents`, {
		method: "POST",
		headers: serverHeaders(env),
		body: JSON.stringify({ documentId, data, permissions }),
	});
	if (res.status === 409) return "conflict";
	if (!res.ok) throw new Error(`createDocument ${res.status}: ${await res.text()}`);
	return (await res.json()) as Record<string, any>;
}

async function appwriteUpdateDocument(
	env: Env,
	collectionId: string,
	docId: string,
	data: Record<string, unknown>,
): Promise<void> {
	const res = await fetch(`${dbBase(env)}/${collectionId}/documents/${docId}`, {
		method: "PATCH",
		headers: serverHeaders(env),
		body: JSON.stringify({ data }),
	});
	if (!res.ok) throw new Error(`updateDocument ${res.status}: ${await res.text()}`);
}

// Days + kind for a store product id. Plans live in the single app_config doc
// as `featurePlans` / `listingPlans` JSON strings; config overrides the built-in
// defaults by productId. Tolerant — ignores malformed config.
async function resolveProduct(
	env: Env,
	productId: string,
): Promise<{ days: number; kind: ProductKind } | null> {
	const q = encodeURIComponent(JSON.stringify({ method: "limit", values: [1] }));
	const res = await fetch(
		`${dbBase(env)}/${env.APP_CONFIG_COLLECTION_ID}/documents?queries[]=${q}`,
		{ headers: serverHeaders(env) },
	);
	const plans: Plan[] = [...DEFAULT_PLANS];
	if (res.ok) {
		const data = (await res.json()) as {
			documents?: Array<{ featurePlans?: string; listingPlans?: string }>;
		};
		const doc = data.documents?.[0];
		mergePlans(plans, doc?.featurePlans, "feature");
		mergePlans(plans, doc?.listingPlans, "listing");
	}
	const plan = plans.find((p) => p.productId === productId);
	return plan ? { days: plan.days, kind: plan.kind } : null;
}

// Upsert plans from a config JSON string into `into` (config overrides defaults
// by productId).
function mergePlans(into: Plan[], raw: string | undefined, kind: ProductKind): void {
	const trimmed = raw?.trim();
	if (!trimmed) return;
	try {
		const parsed = JSON.parse(trimmed) as Array<Partial<Plan>>;
		if (!Array.isArray(parsed)) return;
		for (const p of parsed) {
			if (!p.productId || typeof p.days !== "number") continue;
			const plan: Plan = {
				id: p.id ?? p.productId,
				days: p.days,
				productId: p.productId,
				kind,
			};
			const idx = into.findIndex((x) => x.productId === p.productId);
			if (idx >= 0) into[idx] = plan;
			else into.push(plan);
		}
	} catch {
		/* ignore malformed config */
	}
}

// ── Email helpers ───────────────────────────────────────────────────
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
// Deterministic Appwrite documentId for an email's OTP record (<=36 chars).
async function emailKey(email: string): Promise<string> {
	return (await sha256Hex(normalizeEmail(email))).slice(0, 36);
}
// True if an Appwrite account already exists for this email (admin Users API).
// Fail-open: a lookup hiccup must not block a legitimate signup.
async function isEmailRegistered(env: Env, email: string): Promise<boolean> {
	const q = encodeURIComponent(
		JSON.stringify({ method: "equal", attribute: "email", values: [email] }),
	);
	const res = await fetch(`${env.APPWRITE_ENDPOINT}/users?queries[]=${q}`, {
		headers: serverHeaders(env),
	});
	if (!res.ok) return false;
	const data = (await res.json()) as { total?: number };
	return (data.total ?? 0) > 0;
}

// Look up an Appwrite account by email (admin Users API). Returns the first
// matching user record (with $id) or null. The password-reset flow uses this:
// unlike signup, reset REQUIRES the email to already have an account, and there
// is no session, so we resolve the user with the admin API key.
async function getUserByEmail(
	env: Env,
	email: string,
): Promise<Record<string, any> | null> {
	const q = encodeURIComponent(
		JSON.stringify({ method: "equal", attribute: "email", values: [email] }),
	);
	const res = await fetch(`${env.APPWRITE_ENDPOINT}/users?queries[]=${q}`, {
		headers: serverHeaders(env),
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { users?: Array<Record<string, any>> };
	return data.users?.[0] ?? null;
}

// ── /email/send ─────────────────────────────────────────────────────
// Generate a 6-digit OTP for an email and deliver it via Resend. Keyed by the
// email (no account exists yet during signup). A JWT is optional and only used
// by the existing-user re-verify gate to bypass the "already registered" guard.
async function handleSendOtp(request: Request, env: Env): Promise<Response> {
	const limited = await enforceRateLimit(env.RL_EMAIL_SEND, request);
	if (limited) return limited;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: "Bad request." }, 400);
	}
	const email = normalizeEmail(String(body?.email ?? ""));
	if (!isValidEmail(email)) {
		return json({ message: "Enter a valid email address." }, 400);
	}

	// Optional JWT: present only for the existing-user re-verify gate. When it is
	// a valid token for THIS email we skip the "already registered" guard (the
	// account is meant to exist). New signups send no JWT.
	const jwt: string | undefined = body?.jwt;
	let viaExistingAccount = false;
	let existingUserId = "";
	if (jwt) {
		const account = await appwriteGetAccount(env, jwt);
		if (account && normalizeEmail(String(account.email ?? "")) === email) {
			if (account.emailVerification) return json({ ok: true }); // already verified
			viaExistingAccount = true;
			existingUserId = String(account.$id);
		}
	}

	if (!viaExistingAccount && (await isEmailRegistered(env, email))) {
		return json(
			{ message: "That email already has an account — sign in instead." },
			409,
		);
	}

	const key = await emailKey(email);

	// Server-side cooldown — block hammering a single address (UI also caps at 30s).
	const existing = await appwriteGetDocument(
		env,
		env.EMAIL_OTPS_COLLECTION_ID,
		key,
	);
	if (existing) {
		const last = Date.parse(String(existing.createdAt ?? "")) || 0;
		if (Date.now() - last < 30_000) {
			return json(
				{ message: "Hang on a moment before requesting another code." },
				429,
			);
		}
	}

	const code = generateOtp();
	const ttl = Number(env.OTP_TTL_MINUTES || "10") || 10;
	const record = {
		userId: existingUserId || key,
		email,
		codeHash: await sha256Hex(`${code}:${email}`),
		expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
		attempts: 0,
		verified: false,
		createdAt: new Date().toISOString(),
	};

	// Upsert keyed by emailKey — one active code per email; resend overwrites.
	const created = await appwriteCreateDocument(
		env,
		env.EMAIL_OTPS_COLLECTION_ID,
		record,
		[],
		key,
	);
	if (created === "conflict") {
		await appwriteUpdateDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key, record);
	}

	const sent = await sendResendOtp(env, email, code, ttl);
	if (!sent) return json({ message: "Couldn't send the email. Try again." }, 502);

	return json({ ok: true });
}

// ── /email/verify ───────────────────────────────────────────────────
// Check the code against the stored hash. On success, flag the record verified
// and extend its life to a 30-min window so the user can finish signup. The
// account is marked verified later, in /email/confirm.
async function handleVerifyOtp(request: Request, env: Env): Promise<Response> {
	const limited = await enforceRateLimit(env.RL_EMAIL_VERIFY, request);
	if (limited) return limited;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: "Bad request." }, 400);
	}
	const email = normalizeEmail(String(body?.email ?? ""));
	const code = String(body?.code ?? "").trim();
	if (!isValidEmail(email)) {
		return json({ message: "Enter a valid email address." }, 400);
	}
	if (!/^\d{6}$/.test(code)) {
		return json({ message: "Enter the 6-digit code." }, 400);
	}

	const key = await emailKey(email);
	const otp = await appwriteGetDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key);
	if (!otp) return json({ message: "No code found — tap Resend." }, 400);
	if (new Date(otp.expiresAt as string).getTime() < Date.now()) {
		return json({ message: "That code expired — tap Resend." }, 400);
	}
	if (((otp.attempts as number) ?? 0) >= 5) {
		return json({ message: "Too many attempts — tap Resend." }, 429);
	}

	const codeHash = await sha256Hex(`${code}:${email}`);
	if (codeHash !== otp.codeHash) {
		await appwriteUpdateDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key, {
			attempts: ((otp.attempts as number) ?? 0) + 1,
		}).catch(() => {});
		return json({ message: "Incorrect code. Try again." }, 400);
	}

	await appwriteUpdateDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key, {
		verified: true,
		expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
	});
	return json({ ok: true });
}

// ── /email/confirm ──────────────────────────────────────────────────
// Mark the now-existing account's email verified — but only if that email
// passed OTP verification (verified flag) and the proof window is still open.
// Keyed by the JWT's account email, so a client can't confirm an address it
// never proved. Used by both signup (after account creation) and the gate.
async function handleConfirmOtp(request: Request, env: Env): Promise<Response> {
	const limited = await enforceRateLimit(env.RL_EMAIL_CONFIRM, request);
	if (limited) return limited;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: "Bad request." }, 400);
	}
	const jwt: string | undefined = body?.jwt;
	if (!jwt) return json({ message: "Missing session token." }, 401);

	const account = await appwriteGetAccount(env, jwt);
	if (!account) {
		return json({ message: "Your session expired. Sign in again." }, 401);
	}
	const userId = account.$id as string;
	const email = normalizeEmail(String(account.email ?? ""));
	if (account.emailVerification) return json({ ok: true }); // already verified

	const key = await emailKey(email);
	const otp = await appwriteGetDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key);
	if (!otp || otp.verified !== true) {
		return json({ message: "Email not verified yet." }, 400);
	}
	if (new Date(otp.expiresAt as string).getTime() < Date.now()) {
		return json({ message: "Verification expired — start again." }, 400);
	}

	const marked = await markEmailVerified(env, userId);
	if (!marked) return json({ message: "Couldn't verify. Try again." }, 502);
	await appwriteDeleteDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key).catch(
		() => {},
	);
	return json({ ok: true });
}

// ── /email/reset-send ───────────────────────────────────────────────
// Password reset, step 1. Unlike /email/send (signup), this REQUIRES the email
// to already have an account — and there's no session, so we resolve the account
// with the admin Users API. Emails a 6-digit code stored exactly like a verify
// code (same collection + schema), keyed by the email. Reuses RL_EMAIL_SEND.
async function handleResetSend(request: Request, env: Env): Promise<Response> {
	const limited = await enforceRateLimit(env.RL_EMAIL_SEND, request);
	if (limited) return limited;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: "Bad request." }, 400);
	}
	const email = normalizeEmail(String(body?.email ?? ""));
	if (!isValidEmail(email)) {
		return json({ message: "Enter a valid email address." }, 400);
	}

	// Reset only makes sense for an existing account. Revealing this (rather than
	// a silent 200) matches the rest of the app's messaging and gives immediate
	// feedback; the per-IP rate limit back-stops enumeration abuse.
	const user = await getUserByEmail(env, email);
	if (!user) {
		return json({ message: "No account found with that email." }, 404);
	}

	const key = await emailKey(email);

	// Server-side cooldown — block hammering a single address (UI also caps at 30s).
	const existing = await appwriteGetDocument(
		env,
		env.EMAIL_OTPS_COLLECTION_ID,
		key,
	);
	if (existing) {
		const last = Date.parse(String(existing.createdAt ?? "")) || 0;
		if (Date.now() - last < 30_000) {
			return json(
				{ message: "Hang on a moment before requesting another code." },
				429,
			);
		}
	}

	const code = generateOtp();
	const ttl = Number(env.OTP_TTL_MINUTES || "10") || 10;
	const record = {
		userId: String(user.$id),
		email,
		codeHash: await sha256Hex(`${code}:${email}`),
		expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
		attempts: 0,
		verified: false,
		createdAt: new Date().toISOString(),
	};

	// Upsert keyed by emailKey — one active code per email; resend overwrites.
	const created = await appwriteCreateDocument(
		env,
		env.EMAIL_OTPS_COLLECTION_ID,
		record,
		[],
		key,
	);
	if (created === "conflict") {
		await appwriteUpdateDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key, record);
	}

	const sent = await sendResendOtp(env, email, code, ttl, "reset");
	if (!sent) return json({ message: "Couldn't send the email. Try again." }, 502);

	return json({ ok: true });
}

// ── /email/reset ────────────────────────────────────────────────────
// Password reset, step 2 (atomic). Verify the code, then set the new password
// with the admin Users API. No session and no lingering "proven" window — verify
// and set happen in one call. On success the code is consumed. Reuses
// RL_EMAIL_VERIFY.
async function handleResetPassword(
	request: Request,
	env: Env,
): Promise<Response> {
	const limited = await enforceRateLimit(env.RL_EMAIL_VERIFY, request);
	if (limited) return limited;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: "Bad request." }, 400);
	}
	const email = normalizeEmail(String(body?.email ?? ""));
	const code = String(body?.code ?? "").trim();
	const password = String(body?.password ?? "");
	if (!isValidEmail(email)) {
		return json({ message: "Enter a valid email address." }, 400);
	}
	if (!/^\d{6}$/.test(code)) {
		return json({ message: "Enter the 6-digit code." }, 400);
	}
	if (password.length < 8) {
		return json({ message: "Password must be at least 8 characters." }, 400);
	}

	const key = await emailKey(email);
	const otp = await appwriteGetDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key);
	if (!otp) return json({ message: "No code found — tap Resend." }, 400);
	if (new Date(otp.expiresAt as string).getTime() < Date.now()) {
		return json({ message: "That code expired — tap Resend." }, 400);
	}
	if (((otp.attempts as number) ?? 0) >= 5) {
		return json({ message: "Too many attempts — tap Resend." }, 429);
	}

	const codeHash = await sha256Hex(`${code}:${email}`);
	if (codeHash !== otp.codeHash) {
		await appwriteUpdateDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key, {
			attempts: ((otp.attempts as number) ?? 0) + 1,
		}).catch(() => {});
		return json({ message: "Incorrect code. Try again." }, 400);
	}

	// Re-resolve the account by email (don't trust a stored id) and set the
	// password with the admin Users API.
	const user = await getUserByEmail(env, email);
	if (!user) return json({ message: "No account found with that email." }, 404);

	const ok = await updateUserPassword(env, String(user.$id), password);
	if (!ok) {
		return json({ message: "Couldn't reset your password. Try again." }, 502);
	}

	await appwriteDeleteDocument(env, env.EMAIL_OTPS_COLLECTION_ID, key).catch(
		() => {},
	);
	return json({ ok: true });
}

// Verify a user JWT → their account (incl. email + emailVerification).
async function appwriteGetAccount(
	env: Env,
	jwt: string,
): Promise<Record<string, any> | null> {
	const res = await fetch(`${env.APPWRITE_ENDPOINT}/account`, {
		headers: {
			"content-type": "application/json",
			"x-appwrite-project": env.APPWRITE_PROJECT_ID,
			"x-appwrite-jwt": jwt,
		},
	});
	if (!res.ok) return null;
	return (await res.json()) as Record<string, any>;
}

// Admin Users API — set the account's email as verified. Needs the API key to
// have users.read + users.write scopes.
async function markEmailVerified(env: Env, userId: string): Promise<boolean> {
	const res = await fetch(
		`${env.APPWRITE_ENDPOINT}/users/${userId}/verification`,
		{
			method: "PATCH",
			headers: serverHeaders(env),
			body: JSON.stringify({ emailVerification: true }),
		},
	);
	if (!res.ok) console.error("markEmailVerified failed", res.status, await res.text());
	return res.ok;
}

// Admin Users API — set a new password for the account. Needs the API key to
// have users.write scope (same key as markEmailVerified). Appwrite hashes it.
async function updateUserPassword(
	env: Env,
	userId: string,
	password: string,
): Promise<boolean> {
	const res = await fetch(`${env.APPWRITE_ENDPOINT}/users/${userId}/password`, {
		method: "PATCH",
		headers: serverHeaders(env),
		body: JSON.stringify({ password }),
	});
	if (!res.ok)
		console.error("updateUserPassword failed", res.status, await res.text());
	return res.ok;
}

async function appwriteDeleteDocument(
	env: Env,
	collectionId: string,
	docId: string,
): Promise<void> {
	await fetch(`${dbBase(env)}/${collectionId}/documents/${docId}`, {
		method: "DELETE",
		headers: serverHeaders(env),
	});
}

function generateOtp(): string {
	const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	return n.toString().padStart(6, "0");
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

type OtpKind = "verify" | "reset";

async function sendResendOtp(
	env: Env,
	to: string,
	code: string,
	ttlMinutes: number,
	kind: OtpKind = "verify",
): Promise<boolean> {
	const noun = kind === "reset" ? "password reset" : "verification";
	const lead =
		kind === "reset"
			? `Your Hidden Plate password reset code is ${code}.`
			: `Your Hidden Plate verification code is ${code}.`;
	try {
		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				authorization: `Bearer ${env.RESEND_API_KEY}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from: env.RESEND_FROM,
				to: [to],
				subject: `${code} is your Hidden Plate ${noun} code`,
				text: `${lead} It expires in ${ttlMinutes} minutes. If you didn't request this, ignore this email.`,
				html: otpEmailHtml(code, ttlMinutes, kind),
			}),
		});
		if (!res.ok) {
			console.error("resend send failed", res.status, await res.text());
		}
		return res.ok;
	} catch (err) {
		console.error("resend send error", err);
		return false;
	}
}

function otpEmailHtml(
	code: string,
	ttlMinutes: number,
	kind: OtpKind = "verify",
): string {
	const intro =
		kind === "reset"
			? "Enter this code to reset your password:"
			: "Enter this code to verify your email:";
	return `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border-radius:16px;padding:32px;">
<tr><td style="font-size:20px;font-weight:800;color:#111;padding-bottom:8px;">Hidden Plate</td></tr>
<tr><td style="font-size:15px;color:#555;line-height:22px;padding-bottom:20px;">${intro}</td></tr>
<tr><td style="font-size:34px;font-weight:800;letter-spacing:10px;color:#FF6B35;background:#FFF1EC;border-radius:12px;text-align:center;padding:16px 0;">${code}</td></tr>
<tr><td style="font-size:13px;color:#999;line-height:20px;padding-top:20px;">This code expires in ${ttlMinutes} minutes. If you didn't request it, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

function json(obj: unknown, status = 200): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

// ── HTTP helper ─────────────────────────────────────────────────────
function text(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}
