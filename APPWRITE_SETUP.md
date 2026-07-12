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

**Permissions:** The **admins team** needs **Create** (admin add + bulk import)
and **Update** (admin console). The worker writes via its API key, which bypasses
permissions.

> **⚠️ Do NOT grant `Create` to the Users role.** User submissions now go through
> the Cloudflare Worker (`POST /restaurant/submit`), which force-sets every trust
> field (`isActive:false`, `isVerified:false`, `isFeatured:false`, `ownerId:null`,
> `averageRating:0`, `reviewCount:0`, `addedBy` from the caller's JWT) with the
> admin API key. If Users keep the `Create` grant, a tampered client can bypass
> the worker and self-publish/verify/feature — the exact issue this closes. See
> §15 below.
>
> The worker endpoint is live once `worker/` is deployed (`cd worker && npm run
> deploy`); the app finds it from `EXPO_PUBLIC_EMAIL_OTP_URL`'s origin, so no new
> env var is needed. If that URL is unset, `createRestaurant` falls back to a
> direct client write (honest-client only) — so deploy the worker AND drop the
> Users `Create` grant together.

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
  `/email/send` **5/min**, `/email/verify` **10/min**, `/email/confirm` **10/min**,
  `/restaurant/submit` **3/min** per IP.
  This stops a single IP rotating through many addresses to email-bomb inboxes or burn Resend
  quota — the per-*email* cooldown alone couldn't. The submit cap stops a scripted client
  (even one holding a valid JWT) from flooding the admin queue with pending restaurants.
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

## 12. `postLikes` + `postComments` — likes & comments on community posts

Optional feature: gives plain community posts (the `posts` collection) their own
likes and comment threads, independent of reviews. Tapping a post in the
Community feed opens the post thread (`app/post/[id].tsx`); the feed card and the
thread show a live like count + comment count.

**Design note — no counters on the post doc.** A post is only updatable by its
author (per-doc permission), so a liker/commenter can't bump a counter on it.
Instead these two collections ARE the source of truth: counts are derived by
querying them (`services/postLikes.ts`, `services/postComments.ts`). No server
Function is involved. Each feature is independent — enable likes, comments, or
both.

Create a collection `postLikes`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `postId` | String | 36 | Yes | the liked post's `$id` |
| `userId` | String | 64 | Yes | the liker's auth user id |

- **Index:** unique compound `post_user_idx` on (`postId`, `userId`) — one like
  per user per post, and makes double-taps a no-op. Add a key index on `postId`
  alone for the count/batch queries.
- **Permissions (collection-level):** **Users → Create.**
- **Document Security: ON.** The app sets per-doc `read(users)` + `delete(owner)`
  on create, so anyone can see the like exists but only the liker can remove it.

Create a collection `postComments`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `postId` | String | 36 | Yes | the commented post's `$id` |
| `userId` | String | 64 | Yes | the commenter's auth user id |
| `text` | String | 1000 | Yes | the comment body |

- **Index:** key on `postId` (thread lookup + batch counts).
- **Permissions (collection-level):** **Users → Create.**
- **Document Security: ON.** The app sets per-doc `read(users)` + `delete(owner)`
  on create — anyone can read the thread; only the author can delete their comment.

Put the ids in `.env.local` as `EXPO_PUBLIC_APPWRITE_POST_LIKES_COLLECTION_ID`
and `EXPO_PUBLIC_APPWRITE_POST_COMMENTS_COLLECTION_ID` (+ EAS env) and restart
Metro `--clear`. Until each is set, that action is hidden (no like button /
"commenting isn't available yet") and the rest of the feed is unaffected.

> Security note: like reviews, these collections are Users-writable and rely on
> per-doc permissions + Document Security being ON. The like/comment *counts*
> are read off the collections, so they can't be inflated by writing to the post
> doc — but a modified client could still create rows directly. That's the same
> honest-client posture as the rest of the app; a server Function would be the
> hard boundary if abuse shows up. See the security audit for context.

---

## 13. `postReports` — reporting community posts

Optional feature: lets signed-in users report a community post as inappropriate
(from the post's ⋯ menu in the feed). Reports land in **Admin → Post reports**,
where you delete the post or dismiss the report(s). Mirrors the review/comment
report flow — manual review, no auto-hide (posts are owner-only writable).

Create a collection `postReports`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `postId` | String | 36 | Yes | the reported post's `$id` |
| `reportedByUserId` | String | 64 | Yes | who filed the report |
| `reason` | String | 16 | Yes | `inappropriate` / `spam` / `fake` / `other` |
| `notes` | String | 1000 | No | optional free-text detail |

- **Index:** unique compound `post_reporter_idx` on (`postId`, `reportedByUserId`)
  — one report per user per post (a repeat report is a silent no-op). Add a key
  index on `postId` for the admin grouping query.
- **Permissions (collection-level):** **Users → Create**; **Admins team → Read /
  Delete** (the admin queue reads + dismisses). Document Security: **ON** (the
  reporter also gets per-doc Read on their own report).

Put the id in `.env.local` as `EXPO_PUBLIC_APPWRITE_POST_REPORTS_COLLECTION_ID`
(+ EAS env) and restart Metro `--clear`. Until it's set, the "Report" action and
the admin section stay hidden.

---

## 14. `postCommentReports` — reporting comments on posts

Optional feature: lets users report a comment on a community post (the ⋯/flag
on each comment in the post thread). Reports land in **Admin → Post comment
reports**, where you delete the comment or dismiss the report(s). Same model as
review-comment reports.

Create a collection `postCommentReports`:

| Attribute | Type | Size | Required | Notes |
|---|---|---|---|---|
| `commentId` | String | 36 | Yes | the reported comment's `$id` |
| `postId` | String | 36 | Yes | the parent post's `$id` (admin deep-link) |
| `reportedByUserId` | String | 64 | Yes | who filed the report |
| `reason` | String | 16 | Yes | `inappropriate` / `spam` / `fake` / `other` |
| `notes` | String | 1000 | No | optional free-text detail |

- **Index:** unique compound `comment_reporter_idx` on (`commentId`,
  `reportedByUserId`) — one report per user per comment. Add a key index on
  `commentId` for the admin grouping query.
- **Permissions (collection-level):** **Users → Create**; **Admins team → Read /
  Delete**. Document Security: **ON** (reporter gets per-doc Read).
- **Note:** deleting a reported comment from the admin queue calls
  `deletePostComment`, which needs the **Admins team** to have **Delete** on the
  `postComments` collection (same as reviewComments) — grant that if you haven't.

Put the id in `.env.local` as
`EXPO_PUBLIC_APPWRITE_POST_COMMENT_REPORTS_COLLECTION_ID` (+ EAS env) and restart
Metro `--clear`. Until it's set, the per-comment report action and the admin
section stay hidden.

---

## 15. `send-notification` Appwrite Function — push + in-app notifications

The **`send-notification`** Function (`appwrite-functions/send-notification/`) is
the single server-side entry point for notifications. It runs with an **API
key** so it can write counters the caller doesn't own, read other users' push
tokens, and fan out broadcasts. The app calls it via
`functions.createExecution` from `src/services/notificationTriggers.ts`.

It has five modes, selected by the payload:

| Mode | Trigger | Who calls it |
|---|---|---|
| **Single-recipient — USER** | default (no `broadcast`/`moderation`/`editReview` flag) + signed-in caller | the app (like / comment / follow) |
| **Single-recipient — ADMIN** | default + valid `adminSecret` | you, from the Console / a trusted backend |
| **Broadcast** | `broadcast: true` + valid `adminSecret` | admin announcements |
| **Moderation** | `moderation: true` | report-threshold auto-hide |
| **Review edit** | `editReview: true` + signed-in caller | the app (author edits their own review) |

### Deploy + configure

1. Create the Function (Node runtime), deploy the `send-notification/` folder.
2. **Execute permission → `Users`** (Console → Function → Settings → Execute
   access). This is a **security boundary**, not a convenience: the USER path
   reads the caller's identity from the `x-appwrite-user-id` header Appwrite
   only injects for authenticated executions. Setting it to `Any` would let
   anonymous callers through. (The ADMIN path doesn't need the header — the
   `adminSecret` authorizes it — which is why Console executions still work.)
3. Give the Function's API key these scopes: `documents.read`,
   `documents.write`, `users.read`.
4. Set the Function **environment variables**:

```
APPWRITE_API_KEY                 API key with the scopes above
DATABASE_ID
NOTIFICATIONS_COLLECTION_ID
PUSH_TOKENS_COLLECTION_ID
REVIEWS_COLLECTION_ID
REVIEW_LIKES_COLLECTION_ID       source-of-truth for likeCount bumps
REVIEW_COMMENTS_COLLECTION_ID    source-of-truth for commentCount + review comment snippets
POST_COMMENTS_COLLECTION_ID      source-of-truth for post comment snippets
USERS_COLLECTION_ID              (broadcast recipient enumeration)
REVIEW_REPORTS_COLLECTION_ID     (moderation mode)
ADMIN_SECRET                     shared secret for the ADMIN + broadcast paths
MODERATION_REPORT_THRESHOLD      optional, default 3
```

Put the Function **ID** in the app env as
`EXPO_PUBLIC_APPWRITE_SEND_NOTIFICATION_FUNCTION_ID` so the triggers can find
it (until set, the app logs a warning and skips dispatch).

### Security model (why the payloads look the way they do)

- **Actor is never trusted from the payload.** In the USER path the acting user
  is the `x-appwrite-user-id` header; any `actorId` you send is ignored. You
  can't impersonate another user.
- **Text is never trusted from the payload** (USER path). `title`/`body` are
  built server-side from `type` + target kind + the caller's **real** display
  name (Users API). Comment snippets are read from the caller's **own comment
  row in the DB**, not the payload. A modified client can't inject deceptive or
  phishing text.
- **Counter bumps are constrained.** `bumpCounter.field` must be
  `likeCount` or `commentCount`, the caller must own the matching like/comment
  row, and the counter is **set to the authoritative row count** (immune to
  replayed executions), never blindly incremented.
- The **ADMIN path** (valid `adminSecret`) bypasses all of the above — custom
  `title`/`body`/`actorId` are trusted verbatim (still URL-filtered). Use it
  only from trusted places (the Console, a server), never ship the secret in
  the app.
- **Review edits are ownership-gated and field-whitelisted.** Because Appwrite
  document permissions are all-or-nothing, the `reviews` collection grants its
  author **no** direct `update` permission — a direct grant would also let a
  tampered client flip `isHidden` (reversing a moderation auto-hide) or inflate
  `likeCount`/`commentCount`. Authors edit through the `editReview` path
  instead: the Function verifies the caller owns the review (via the
  `x-appwrite-user-id` header), re-validates the input (rating range, comment
  length, link rejection, ≤6 images), and writes **only** `rating` / `comment` /
  `imageIds` / `isEdited`. Moderation and counter fields can never be set from
  the payload.

### JSON payloads by notification type

The app builds these in `notificationTriggers.ts`; you'd only hand-write them
for Console testing or admin sends. In the USER path the recipient is `userId`
(the target's **auth user id**, i.e. the `userId` field on their docs — not the
document `$id`), and the actor is the signed-in caller.

**Follow** — someone followed `userId`:
```json
{ "userId": "<recipient auth id>", "type": "follow" }
```

**Like on a review** — bumps `likeCount`, notifies the author:
```json
{
  "userId": "<review author auth id>",
  "type": "like",
  "data": { "reviewId": "<reviewId>" },
  "bumpCounter": { "reviewId": "<reviewId>", "field": "likeCount" }
}
```

**Like on a community post** — no counter (post like counts are read off
`postLikes`):
```json
{
  "userId": "<post author auth id>",
  "type": "like",
  "data": { "postId": "<postId>" }
}
```

**Comment on a review** — bumps `commentCount`; the snippet is pulled from the
caller's own comment row, so you don't send the text:
```json
{
  "userId": "<review author auth id>",
  "type": "comment",
  "data": { "reviewId": "<reviewId>" },
  "bumpCounter": { "reviewId": "<reviewId>", "field": "commentCount" }
}
```

**Comment on a community post** — no counter; snippet pulled from `postComments`:
```json
{
  "userId": "<post author auth id>",
  "type": "comment",
  "data": { "postId": "<postId>" }
}
```

**Counter-only** — bump without notifying (self-action or deduped notification).
`userId`/`type` aren't required; only the bump is honored:
```json
{
  "skipNotification": true,
  "bumpCounter": { "reviewId": "<reviewId>", "field": "likeCount" }
}
```

**ADMIN — custom notification to one user** (Console / backend). Requires
`adminSecret`; `title`/`body`/`actorId`/`data` are trusted as-is:
```json
{
  "adminSecret": "<ADMIN_SECRET>",
  "userId": "<recipient auth id>",
  "type": "system",
  "title": "Heads up",
  "body": "Your restaurant claim was approved.",
  "actorId": "",
  "data": { "restaurantId": "<id>" }
}
```
> `type` maps to a preference toggle: `like`→`notifyOnLike`,
> `comment`→`notifyOnComment`, `follow`→`notifyOnFollow`,
> `broadcast`/`new_restaurant`→`notifyOnBroadcast`. A type with no mapping
> (e.g. `system`) is gated only by the master `notificationsEnabled` toggle.

**Broadcast — announce to every user** (Console / admin). Honors each
recipient's `notifyOnBroadcast` + master toggle:
```json
{
  "broadcast": true,
  "adminSecret": "<ADMIN_SECRET>",
  "type": "broadcast",
  "title": "New feature",
  "body": "Community posts are live — tap to explore.",
  "data": { "screen": "community" }
}
```

**Moderation — recount reports, auto-hide at threshold** (no auth; only acts on
real report counts):
```json
{ "moderation": true, "reviewId": "<reviewId>" }
```

**Review edit — author updates their own review's content** (signed-in caller;
the Function verifies ownership and writes only the whitelisted fields). Send
only the fields being changed:
```json
{
  "editReview": true,
  "reviewId": "<reviewId>",
  "rating": 4,
  "comment": "Updated my thoughts after a second visit.",
  "imageIds": ["<fileId>"]
}
```
> ⚠️ **Migration for the `reviews` collection.** New reviews are created with
> **no author `update` permission** (`src/services/reviews.ts`). Existing review
> documents created before this change still carry a stale
> `update("user:<author>")` grant, so their authors can still bypass the
> Function. Strip it: run a one-off script (or the Console) over the `reviews`
> collection setting each doc's permissions to `read("users")` +
> `delete("user:<author>")` only. Docs also self-heal the next time their author
> edits them (the `editReview` path re-asserts the hardened permission set).

> Title/body in every path are rejected if they contain a URL (links are
> stripped from notifications by design). `data` is not URL-filtered — keep
> deep-link params there, not in the visible text.

### The `notifications` + `pushTokens` collections

The Function reads/writes these with its API key. **Neither grants any write
permission to Users** — that's what stops the two attacks below.

**`notifications`** — in-app notification feed. Attributes: `userId` (64),
`actorId` (64), `type` (16), `title` (256), `body` (512), `data` (String,
JSON), `isRead` (Boolean).
- **Document Security: ON.** The Function stamps each doc with
  `read/update/delete` for the recipient only, so a user sees only their own
  feed and can mark/delete their own rows.
- **Collection-level permissions:** none for Users (no create/read at the
  collection level — per-doc read is what grants access). Only the API key
  creates rows, so no one can forge a notification into someone's feed.

**`pushTokens`** — Expo push tokens for targeting. Attributes: `userId` (64),
`token` (256), `platform` (16, `ios`/`android`).
- **Index:** unique compound `user_token_idx` on (`userId`, `token`).
- **Document Security: ON.**
- **Collection-level permissions:** **none for Users.** In particular do **not**
  grant Users `Create`. Registration goes through the Function
  (`manageToken: "register"`), which binds the token to the
  `x-appwrite-user-id` header and ignores any client-supplied `userId`. If you
  grant Users `Create` here, an attacker can insert `{ userId: <victim>,
  token: <their device> }` and receive the victim's pushes (follower names,
  comment snippets — a PII leak). The Function-only path closes that.
- On register the Function also deletes any row holding the **same token under a
  different user** (a device that switched accounts), so a stale row can't keep
  leaking pushes to a previous owner.

**Push-token payloads** (both require a signed-in caller; `userId` is always the
auth header, never the payload):

Register / refresh this device's token (called on login):
```json
{ "manageToken": "register", "token": "ExponentPushToken[xxxxxxxx]", "platform": "ios" }
```

Clear this device's tokens (called from `auth.logout()` **before** the session
is destroyed — once the session is gone the Function refuses the anonymous
call):
```json
{ "manageToken": "clear" }
```

---

## 16. Restaurant submissions go through the worker (trust-field gatekeeper)

User-submitted restaurants are created by the Cloudflare Worker, not the client,
so the moderation/trust fields can't be forged. Implemented in
`worker/src/index.ts` as **`POST /restaurant/submit`**:

1. Verifies the caller's Appwrite **JWT** (relayed by the app). No session → 401.
2. Re-validates name / address / parish / coordinates.
3. Creates the doc with the **admin API key**, force-setting `isActive:false`,
   `isVerified:false`, `isFeatured:false`, `ownerId:null`, `averageRating:0`,
   `reviewCount:0`, and `addedBy` = the JWT's user id — overriding anything the
   client sent. Per-doc perms: `read("users")`, `delete("user:<caller>")`.

**To activate the enforcement (both steps needed):**
1. Deploy the worker: `cd worker && npm run deploy`.
2. In the Appwrite console, **remove `Create` from the Users role** on the
   `restaurants` collection (keep **admins team → Create/Update**). This is what
   forces submissions through the worker; without it the direct client path is
   still open.

The worker key already has `documents.read` + `documents.write` (§7), so no new
scopes. The app derives the endpoint from `EXPO_PUBLIC_EMAIL_OTP_URL`'s origin —
no new env var. Admin "Add restaurant" + bulk import still write client-side
(admins-team Create grant); only public submissions are gated. If the worker URL
is unset, `createRestaurant` falls back to a direct client write (honest-client
only), so deploy the worker AND drop the Users `Create` grant together.

---

## `users` collection — no `email` attribute (PII hardening)

Profile docs are readable by **every signed-in user** (per-doc
`read("users")`), so anything stored on them is effectively public to the
whole user base. The app therefore stores **no email on the profile doc** —
the address lives only on the Appwrite **Account**, which only its owner (and
the server API key) can read. The current user's email in the UI comes from
`account.get()` (`mapUserDoc` in `src/services/auth.ts`); users loaded from
the collection (`src/services/users.ts`) have `email: ""`.

**Migration (one-time, do together with shipping this app version):** in the
Appwrite console, **delete the `email` attribute from the `users` collection**.
This both wipes the addresses already sitting in existing docs and keeps new
signups working (older builds that still send `email` will fail to sign up
once the attribute is gone — fine pre-launch, coordinate if already shipped).

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
# Turns on server-side notifications (the send-notification Function — §15).
EXPO_PUBLIC_APPWRITE_SEND_NOTIFICATION_FUNCTION_ID="..."
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
  reset case (logged-out user with an existing account). `/reset-send` targets
  an existing account instead (but never reveals whether one exists — see below).
- The user has no session, so the worker sets the password with its **admin
  Users API key** — the app never holds a session for this.

**`POST /email/reset-send`** — body `{ email }`
1. Resolve the Appwrite account by email (admin Users API). **Anti-enumeration:**
   the response is always a neutral `200 { ok: true }` — if no account exists the
   worker returns that same success **without emailing or storing anything**, so a
   probe can't distinguish a registered address from an unregistered one. (Signup's
   `/email/send` deliberately keeps its "already registered" 409 for UX; reset
   stays neutral because it targets confirmed accounts.) Per-IP `RL_EMAIL_SEND`
   still back-stops bulk probing.
2. Generates a 6-digit code, stores its **hash** + attempt counter in
   `EMAIL_OTPS_COLLECTION_ID` keyed by the email hash, TTL `OTP_TTL_MINUTES`.
3. Emails the code via Resend from `RESEND_FROM` (reset-specific copy).
4. 30s per-email cooldown + per-IP rate limit.
Returns `200 { ok: true }` whether or not the account exists.

**`POST /email/reset`** — body `{ email, code, password }` (atomic verify + set)
1. Validates `password` against the shared policy server-side: **≥ 10 chars, not
   all-numeric, not a common password** (`validatePassword` in
   `worker/src/index.ts`; the client mirrors it in
   `src/utils/passwordPolicy.ts` — keep the two in sync).
2. Looks up the stored OTP; compares hashes, checks TTL + attempt cap. On
   mismatch increments attempts and returns `400 { message: "Incorrect code…" }`.
3. On match: re-resolves the account by email and calls admin
   `PATCH /users/{userId}/password`.
4. Consumes the code (deletes the OTP doc) so it can't be replayed.
5. Emails a best-effort **"your password was changed"** alert (Resend) so a reset
   the real owner didn't initiate is noticeable.
Returns `200 { ok: true }` on success, `4xx { message }` on failure. Keeping
verify+set in one call means no "proven" window lingers for a password change.

**`POST /email/password-changed`** — body `{ jwt }` (in-app change alert)
The in-app "change password" flow writes the new password client-side via the
Appwrite SDK (it needs the OLD password), so the worker's only job is the alert
email. Authenticated by the caller's **JWT**; the email goes to the account's own
address resolved from the token, **never** a body-supplied one — so this can't be
used to spam arbitrary addresses or probe for accounts. Always returns a neutral
`200 { ok: true }` (the email is best-effort). Reuses `RL_EMAIL_SEND`. Called from
`changePassword` in `src/services/auth.ts`, fire-and-forget.

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
