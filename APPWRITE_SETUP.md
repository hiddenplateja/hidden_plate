# Appwrite setup — owner / monetization features

Everything to create in the Appwrite console for: restaurant claims, owner
replies, featured boosts, and the listing fee. All in your existing database.

> **Document Security:** for every collection clients write to (claims,
> reviewResponses, featurePurchases) turn **Document Security ON** (Settings tab).
> Our model relies on per-document permissions applying alongside collection-level
> ones. With it OFF, only collection-level permissions work and the flows break.

> **Dates:** use the **Datetime** attribute type for all `*Until` / `*At` fields.
> The app/worker write ISO 8601 strings, which Datetime accepts.

---

## 1. `restaurants` — ADD attributes to the existing collection

| Attribute | Type | Size | Required | Default | Why |
|---|---|---|---|---|---|
| `ownerId` | String | 64 | No | (none/null) | Verified owner's user id (admin sets on claim approval) |
| `featuredUntil` | Datetime | — | No | (none) | Paid featured-boost expiry (worker sets) |
| `listingPaidUntil` | Datetime | — | No | (none) | Paid listing-window expiry (worker sets; grace on claim approval) |
| `searchText` | String | 500 | No | (none) | Server-search haystack (substring search across the whole catalogue). **After creating it, run Admin → Rebuild search index once** to backfill existing docs. |
| `menu` | String | 4000 | No | (none) | Menu as a JSON string — an array of sections `{ title, items: ["dish name", …] }` (just dish names; the restaurant-level price range covers cost). **Keep the size small (≈4000).** It only holds names, and an oversized String column can push the collection past MariaDB's row-size limit. Written from the restaurant form's **Menu** editor; shown via the **View menu** button on the detail page. The app omits this field on create when the menu is empty. |

**Indexes** (Indexes tab → Create, type **key**):
- `ownerId` (key, ASC) — for "your restaurants" / owner lookups
- `listingPaidUntil` (key, ASC) — **required** for the discovery date-filter (`Query.or`)

**Permissions:** no change for clients. The **admins team** needs **Update**
(already set up for the admin console). The worker writes via its API key, which
bypasses permissions.

> Some of these (`ownerId`, `featuredUntil`) may already exist from earlier
> phases — just add whatever's missing. `listingPaidUntil` + its index are new.

---

## 2. `restaurantClaims` — NEW collection

Env var → `EXPO_PUBLIC_APPWRITE_RESTAURANT_CLAIMS_COLLECTION_ID`

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `restaurantId` | String | 64 | Yes | |
| `userId` | String | 64 | Yes | claimant |
| `status` | String | 16 | Yes | `pending` / `approved` / `rejected` (Enum also fine) |
| `contactName` | String | 128 | Yes | |
| `contactPhone` | String | 32 | Yes | |
| `contactEmail` | String | 256 | Yes | |
| `role` | String | 16 | Yes | `owner` / `manager` |
| `proofNote` | String | 1000 | No | |
| `reviewedAt` | Datetime | — | No | |
| `reviewedBy` | String | 64 | No | |

**Indexes (key):** `restaurantId`, `userId`, `status`

**Permissions (collection-level):**
- **Users** → Create (signed-in users submit claims)
- **Admins team** → Read, Update, Delete (review/approve/reject)
- Document Security: **ON** (the submitter gets per-doc Read + Delete)

---

## 3. `reviewResponses` — NEW collection

Env var → `EXPO_PUBLIC_APPWRITE_REVIEW_RESPONSES_COLLECTION_ID`

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `reviewId` | String | 64 | Yes | |
| `restaurantId` | String | 64 | Yes | |
| `authorId` | String | 64 | Yes | owner's user id |
| `text` | String | 1000 | Yes | |

**Indexes (key):** `reviewId`, `authorId`

**Permissions (collection-level):**
- **Users** → Create (owners post replies; trust is enforced by `authorId === ownerId` at read time)
- **Admins team** → Delete (moderation)
- Document Security: **ON** (each reply is per-doc Read=any, Update/Delete=author)

---

## 4. `featurePurchases` — NEW collection (worker-only ledger)

Used only by the Cloudflare Worker → wrangler var `FEATURE_PURCHASES_COLLECTION_ID`.
**Not** referenced by the app, so it needs **no** `EXPO_PUBLIC_*` env var.

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `restaurantId` | String | 64 | Yes | |
| `userId` | String | 64 | Yes | buyer (RevenueCat app_user_id) |
| `productId` | String | 64 | Yes | e.g. `feature_30d`, `listing_1yr` |
| `days` | Integer | — | Yes | |
| `status` | String | 16 | Yes | `pending` / `completed` / `failed` |
| `featuredUntil` | Datetime | — | No | the granted window end (reused for feature + listing) |
| `transactionId` | String | 256 | No | store transaction id |
| `store` | String | 32 | No | `APP_STORE` / `PLAY_STORE` |
| `createdAt` | Datetime | — | No | |
| `completedAt` | Datetime | — | No | |

**Indexes:** none required (the worker reads/writes by document id). Optional:
`userId` (key) if you later show owners their purchase history.

**Permissions:** none for clients — the worker writes with the **server API key**
(bypasses permissions). Set Document Security **ON** so the per-doc Read the worker
grants the buyer takes effect.

---

## 5. `app_config` — OPTIONAL price/plan overrides

Only if you want to change prices/days **without** an app or worker code change.
Add String attributes (size 16000) to your existing single `app_config` doc:

| Attribute | Type | Size | Notes |
|---|---|---|---|
| `featurePlans` | String | 16000 | JSON array of feature plans |
| `listingPlans` | String | 16000 | JSON array of listing plans |

Example `listingPlans` value:
```json
[{"id":"1yr","label":"1 year","days":365,"amount":5000,"currency":"JMD","productId":"listing_1yr"}]
```
If left unset, the built-in defaults are used (feature_7d/feature_30d,
listing_1yr 365 days).

---

## 6. `emailOtps` — email verification (OTP via the worker + Resend)

Appwrite Cloud's **custom SMTP is paywalled**, so we don't use Appwrite's built-in
Email OTP. Instead the Cloudflare Worker generates the 6-digit code, stores a hash
here, emails it through **Resend**, and on success marks the account verified via
Appwrite's admin Users API. The app only relays a short-lived Appwrite **JWT** so the
worker can trust who's asking.

Create a collection `emailOtps` (any name — its id goes in `wrangler.jsonc`).
The OTP is keyed by the **email** (signup verifies the email *before* an account
exists), so the document id is a hash of the email — not a userId.

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `email` | String | 320 | Yes | where the code was sent |
| `codeHash` | String | 64 | Yes | SHA-256 of `code:email` — never the raw code |
| `expiresAt` | Datetime | — | Yes | code TTL; after the code passes, the 30-min finish-signup window |
| `attempts` | Integer | — | No | wrong-guess counter (capped at 5) |
| `verified` | Boolean | — | No | set `true` once the code is entered correctly |
| `createdAt` | Datetime | — | No | send time (used for the 30s resend cooldown) |
| `userId` | String | 64 | No | bookkeeping — the account id when known, else the email key |

> ⚠️ **Upgrading an existing `emailOtps`?** Add the **`verified` Boolean** attribute —
> the send path writes it and will 500 without it. `userId` is now optional; if yours
> is still Required that's fine (the worker always writes a value).

**Indexes:** none — the worker reads/writes by a deterministic document id derived
from the email (SHA-256, truncated).
**Permissions:** none for clients — only the worker (server API key) touches this.
Document Security can stay **OFF**.

**Resend setup:** create an account at resend.com → **add & verify your sending
domain** (DNS records) → **API Keys → Create**. Put the key in the worker secret
`RESEND_API_KEY`, and set `RESEND_FROM` in `wrangler.jsonc` to an address on that
verified domain (e.g. `Hidden Plate <verify@yourdomain.com>`).

---

## 7. API key for the worker (recap)

Overview → **Integrations → API Keys** → your worker key needs scopes
**`documents.read`** + **`documents.write`** (feature/listing purchases + emailOtps
records) **and** **`users.read`** + **`users.write`** (look up an email's account +
mark it verified). Set the key as the worker secret `APPWRITE_API_KEY`.

> ⚠️ It's **`documents.*`**, not `databases.*`. In Appwrite 1.9.x the scopes are
> granular: `databases.*` only manages *schema* (collections/attributes), while
> reading/writing actual documents requires `documents.read` + `documents.write`. A
> key with only `databases.*` returns `401 user_unauthorized` on every document write.

---

## 8. `lists` — user Collections (curated, shareable)

Optional feature: lets users build named, optionally-public collections of
restaurants (e.g. "Best jerk in Kingston"). Each list stores its restaurants as
an **array of ids** on the doc, so a list's visibility is just the document's
read permission — no join collection.

Create a collection `lists`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `ownerId` | String | 64 | Yes | creator's user id |
| `title` | String | 120 | Yes | |
| `description` | String | 500 | No | |
| `isPublic` | Boolean | — | No (default `false`) | |
| `restaurantIds` | String | 64 | No | **mark it an Array** — the curated, ordered spots |
| `coverRestaurantId` | String | 64 | No | cover image source (falls back to first item) |

- **Index:** `ownerId` (key) — powers "my lists" + a user's public lists.
- **Document Security: ON.** Collection-level permission: grant **Create** to
  **Role: Users** so signed-in users can make lists. Per-doc permissions are set
  by the app: private = owner only; public = owner + Read for **Users** (the app
  swaps this automatically when a list is toggled public/private).

Put the id in `.env.local` as `EXPO_PUBLIC_APPWRITE_LISTS_COLLECTION_ID` (+ EAS
env) and restart Metro `--clear`. Until it's set, the Collections UI stays hidden.

---

## 9. Rate limiting & abuse protection

**Where limits are actually enforced.** The app talks to Appwrite **directly from the
client**, so any limit written in app code is bypassable (call the API with a session token,
skip our code). Real enforcement lives in only two places:

**A. Cloudflare Worker (OTP/email) — already in code, ships on `wrangler deploy`.**
- Per-IP limits via the Workers Rate Limiting API (`ratelimits` in `wrangler.jsonc`):
  `/email/send` **5/min**, `/email/verify` **10/min**, `/email/confirm` **10/min** per IP.
  This stops a single IP rotating through many addresses to email-bomb inboxes or burn Resend
  quota — the per-*email* cooldown alone couldn't.
- Plus, per email: a 30s resend cooldown, a 5 wrong-guess attempt cap, and code expiry.
- Nothing to configure in Appwrite for these.

**B. Appwrite built-in abuse protection — verify it's ON (console).** Appwrite rate-limits
auth + API routes per-IP out of the box:
- **Appwrite Cloud:** on by default (can't be disabled). Auth endpoints — account create,
  email/session create, OTP, password recovery, magic URL — are capped to a small number of
  requests per IP+route per hour. This back-stops signup / login / credential-stuffing spam
  with **no app change needed**.
- **Self-hosted:** keep `_APP_OPTIONS_ABUSE=enabled` (the default) in the server `.env`.
  Setting it to `disabled` (sometimes done for dev/load tests) turns OFF *all* rate limiting —
  never ship that. `_APP_OPTIONS_ROUTER_PROTECTION=enabled` is also recommended in prod.

**What already limits content abuse (no extra config):**
- One report per (user, review) — unique compound index on `reviewReports`
  (`src/services/reports.ts`); re-reporting is a silent no-op.
- Report-threshold auto-hide moderation (the send-notification function hides a review once
  enough distinct reports land).
- Optimistic actions (follow, block, like, save) carry **client in-flight guards** so a fast
  double-tap collapses to one request — UX hardening, **not** a security boundary.

**Deliberately not done:** hard per-user write caps (e.g. "max N reviews/hour"). They can't be
enforced from the client; they'd need those writes routed through an Appwrite Function or the
Worker (which can throttle with the server API key). Add only if content spam becomes real.

---

## 10. `bugReports` — in-app "Report a bug"

Optional feature: lets signed-in users send bug reports / suggestions from
**Settings → Report a bug**, which you triage in **Admin → Bug reports** (mark
resolved / delete). Each report auto-captures the device + app version.

Create a collection `bugReports`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `userId` | String | 64 | Yes | reporter's user id |
| `type` | String | 16 | Yes | `bug` / `suggestion` / `other` (Enum also fine) |
| `message` | String | 2000 | Yes | the report text |
| `deviceInfo` | String | 256 | No | auto-captured "model · OS version · app version (build)" |
| `status` | String | 16 | Yes | `open` / `resolved` — the app defaults new reports to `open` |

**Index:** `status` (key) — optional; handy if you later filter to open reports.

**Permissions (collection-level):**
- **Users** → Create (signed-in users submit reports)
- **Admins team** → Read, Update, Delete (triage)
- Document Security: **ON** (the reporter also gets per-doc Read on their own report)

Put the id in `.env.local` as `EXPO_PUBLIC_APPWRITE_BUG_REPORTS_COLLECTION_ID`
(+ EAS env) and restart Metro `--clear`. Until it's set, the "Report a bug" row
in Settings and the admin section stay hidden.

---

## 11. `restaurantMenus` — owner-editable menu override

Optional feature: lets a **verified restaurant owner** edit their own menu. The
admin-managed base menu still lives on the restaurant doc (`menu` attribute from
§1); this collection holds an owner **override** that wins when present. Owners
get an **Edit menu** button on their restaurant page.

**Why a separate collection:** owners must never get write access to the
restaurant doc — they could grant themselves `isFeatured` and bypass paid
featuring (no field-level permissions in Appwrite). So owner-editable menu data
lives here, isolated.

Create a collection `restaurantMenus`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `menu` | String | 4000 | No | the owner's menu as a JSON string (sections of dish names) |

- **Document id = the restaurant's id** (one override doc per restaurant).
- **Permissions (collection-level):** **Admins team → Create / Read / Update / Delete.**
  **Do NOT grant Users any permission here** — that's what prevents someone
  squatting another restaurant's menu. Document Security: **ON**. The per-doc grant
  (`read(any)`, `update(user:<ownerId>)`) is set by the app at claim approval.
- No index needed (lookups are by document id).

Put the id in `.env.local` as `EXPO_PUBLIC_APPWRITE_RESTAURANT_MENUS_COLLECTION_ID`
(+ EAS env) and restart Metro `--clear`. Until it's set, owner menu editing stays
off and admins manage menus on the restaurant doc as before.

**Backfill:** the owner's menu doc is seeded automatically when you **approve a
claim**. Restaurants claimed *before* this feature won't have one yet — approving
a new claim (or any future owner re-assignment) seeds it. Ask me if you'd like a
one-tap "backfill owner menus" admin action.

---

## Env-var wiring after creating the above

**App `.env.local`** (restart Metro `--clear` after):
```
EXPO_PUBLIC_APPWRITE_RESTAURANT_CLAIMS_COLLECTION_ID="..."
EXPO_PUBLIC_APPWRITE_REVIEW_RESPONSES_COLLECTION_ID="..."
EXPO_PUBLIC_REVENUECAT_IOS_KEY="appl_..."
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY="goog_..."
# Turns on email verification at signup. Point at the worker's /email base.
EXPO_PUBLIC_EMAIL_OTP_URL="https://hidden-plate-pay.<you>.workers.dev/email"
# Turns on user Collections (curated, shareable lists).
EXPO_PUBLIC_APPWRITE_LISTS_COLLECTION_ID="..."
# Turns on the in-app "Report a bug" form + admin queue.
EXPO_PUBLIC_APPWRITE_BUG_REPORTS_COLLECTION_ID="..."
# Turns on owner-editable menus (the restaurantMenus override collection).
EXPO_PUBLIC_APPWRITE_RESTAURANT_MENUS_COLLECTION_ID="..."
```

**Worker `wrangler.jsonc` vars** (already templated):
```
RESTAURANTS_COLLECTION_ID, APP_CONFIG_COLLECTION_ID, FEATURE_PURCHASES_COLLECTION_ID
EMAIL_OTPS_COLLECTION_ID, RESEND_FROM, OTP_TTL_MINUTES
```
**Worker secrets:** `APPWRITE_API_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `RESEND_API_KEY`

---

## Password reset (forgot-password) — worker endpoints

The in-app forgot-password flow (`app/(auth)/forgot-password.tsx` →
`reset-password.tsx`, service fns `requestPasswordReset` / `resetPassword` in
`src/services/auth.ts`) reuses the existing OTP worker + Resend. The two endpoints
are **implemented in `worker/src/index.ts`** (`handleResetSend` /
`handleResetPassword`) under the same `EMAIL_OTP_URL` base (`…/email`). They reuse
the `EMAIL_OTPS_COLLECTION_ID`, `RESEND_FROM`, `OTP_TTL_MINUTES` config, the
`APPWRITE_API_KEY` / `RESEND_API_KEY` secrets, and the existing `RL_EMAIL_SEND` /
`RL_EMAIL_VERIFY` rate limiters — **no new wiring, no Appwrite schema change**
(the OTP record uses the same shape as verify; the API key already has the
`users.read`/`users.write` scopes that `markEmailVerified` relies on).

> **Deploy to activate:** `cd worker && npm run deploy`. Until the worker is
> redeployed, the app shows the "Forgot password?" link (gated on `EMAIL_OTP_URL`,
> same as verification) but `/email/reset-send` 404s and the app shows
> "Couldn't send the reset code."

Why dedicated endpoints rather than reusing `/send` + `/verify`:
- `/send` *rejects* already-registered emails when there's no JWT — the exact
  reset case (logged-out user with an existing account). `/reset-send` does the
  opposite: it *requires* the email to exist.
- The user has no session, so the worker sets the password with its **admin
  Users API key** — the app never holds a session for this.

**`POST /email/reset-send`** — body `{ email }`
1. Resolve the Appwrite account by email (admin Users API). If none exists,
   returns `404 { message: "No account found with that email." }` — this matches
   the rest of the app's messaging; the per-IP `RL_EMAIL_SEND` limiter back-stops
   enumeration abuse. (Switch to a silent `200` here if you prefer strict
   non-enumeration.)
2. Generates a 6-digit code, stores its **hash** + attempt counter in
   `EMAIL_OTPS_COLLECTION_ID` keyed by the email hash, TTL `OTP_TTL_MINUTES`.
3. Emails the code via Resend from `RESEND_FROM` (reset-specific copy).
4. 30s per-email cooldown + per-IP rate limit.
Returns `200 { ok: true }` on success, `4xx { message }` on failure.

**`POST /email/reset`** — body `{ email, code, password }` (atomic verify + set)
1. Validates `password` (length ≥ 8) server-side too.
2. Looks up the stored OTP; compares hashes, checks TTL + attempt cap. On
   mismatch increments attempts and returns `400 { message: "Incorrect code…" }`.
3. On match: re-resolves the account by email and calls admin
   `PATCH /users/{userId}/password`.
4. Consumes the code (deletes the OTP doc) so it can't be replayed.
Returns `200 { ok: true }` on success, `4xx { message }` on failure. Keeping
verify+set in one call means no "proven" window lingers for a password change.

---

## OAuth — Google + Apple sign-in

The **app side is done** (`loginWithGoogle` / `loginWithApple` in
`src/services/auth.ts`, wired into both the login and signup screens). It uses
Appwrite's browser OAuth — `createOAuth2Token` → `expo-web-browser` →
`createSession` — and **auto-creates a profile doc** (with a unique
auto-generated username) for first-time OAuth users, then routes them through
onboarding. They can change the username later in Edit Profile.

It won't function until the providers + credentials are configured. **Only works
in the dev/standalone build** (needs the `hiddenplate://` scheme — not Expo Go).
Rebuild the dev client after any native/app.json change.

### 1. Register the redirect with Appwrite
The OAuth flow redirects back to the app's deep link `hiddenplate://` (the
`scheme` in `app.json`). In **Appwrite Console → your project → Overview → Add
platform**, make sure the native apps are registered with bundle id
`com.hiddenplate.app` so Appwrite accepts the redirect.

### 2. Google
1. **Google Cloud Console → APIs & Services → Credentials → Create OAuth client
   ID** (type: **Web application**).
2. Authorized redirect URI: copy the **exact callback URL** Appwrite shows on its
   Google provider page — it looks like
   `https://nyc.cloud.appwrite.io/v1/account/sessions/oauth2/callback/google/<PROJECT_ID>`.
3. Copy the **Client ID** + **Client secret**.
4. **Appwrite Console → Auth → Settings → Google** → enable → paste **App ID**
   (client id) + **App Secret** (client secret).

### 3. Apple
1. **Apple Developer → Identifiers:** an **App ID** (`com.hiddenplate.app`) with
   *Sign in with Apple* enabled; a **Services ID**; and a **Key** with *Sign in
   with Apple* (download the `.p8`).
2. **Appwrite Console → Auth → Settings → Apple** → enable → fill **Services ID**
   (client id), **Team ID**, **Key ID**, the **P8 private key**, and the bundle id.
3. Add Appwrite's callback URL (shown on the Apple provider page) to the Services
   ID's **Return URLs**.
4. App Store note (guideline 4.8): shipping iOS with Google sign-in requires
   offering Apple too — this satisfies it. For a more native iOS feel you can
   later swap Apple to `expo-apple-authentication`; the browser flow here works
   for both platforms today.

### First-time OAuth users
A brand-new OAuth account has a session but no profile doc. `loginWithOAuth`
returns `{ status: "needs-username", suggested* }` (it does NOT create the doc);
the login/signup screens route to **`app/(auth)/oauth-username.tsx`**, which
pre-fills a suggested handle, lets the user choose, and calls
`completeOAuthSignup` to create the profile + start onboarding. Cancelling there
signs them out (no orphaned session). Returning OAuth users skip straight in.
