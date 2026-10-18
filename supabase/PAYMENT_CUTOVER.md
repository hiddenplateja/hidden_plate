# Payment routing audit and cutover prerequisites

## Launch decision — 2026-10-13

The user confirmed the initial release has no subscriptions or payment-related
activity. All further payment migration/deployment, credentials, checkout wiring
and purchase testing are deferred. The sections below preserve the staged work
and FUTURE payment prerequisites; they are not requirements for the free launch.
Migration 26 remains unapplied; `verify-purchase` remains undeployed. No payment
settings, secrets, webhook or store configuration were changed for this decision.

`PAID_FEATURES_ENABLED=false` already removes paid entry points and skips listing
expiry filtering without affecting free claims, owner menu/replies or manual
admin spotlight. Both legacy RevenueCat and staged Supabase checkout now require
this master flag too: configured keys or an enabled environment flag cannot
activate native purchases. No UI/design edits were made. Store approval cannot
be guaranteed by this decision; non-payment release checks still remain.

2026-10-12. Audit only: no Worker deployment, RevenueCat changes, real purchases,
payment grants or application cutover performed.

## Current implementation

- `src/services/purchases.ts` identifies RevenueCat with the current Appwrite
  user ID and writes the mutable `feature_restaurant_id` subscriber attribute.
  It lazily loads the native SDK and returns store confirmation, not proof that
  restaurant fulfillment completed. Feature/listing checkout share this wrapper.
- The active `/revenuecat/webhook` in `worker/src/index.ts` authenticates its
  configured shared header, handles `NON_RENEWING_PURCHASE`, reads the Appwrite
  plan catalog and restaurant owner, and writes Appwrite's purchase ledger and
  restaurant expiry. R2 routes already use Supabase, but this payment route does not.
- Live Supabase metadata has no `feature_purchases` table. The initial
  `app_config` also had no feature/listing catalog columns. Migration 24 adds
  display catalogs only; it does not provide a payment ledger or grant purchases.

## Required before enabling Supabase purchases

1. Use a separate, explicitly selected Supabase webhook route/integration while
   Appwrite remains active. Do not guess the destination backend from whether an
   ID looks like a UUID; that is not a reliable routing boundary.
2. Identify new purchases with the verified Supabase account. Keep identity changes
   and checkout serialized/pinned so overlapping account changes cannot purchase
   for the wrong account. Handle RevenueCat logout/identity transitions explicitly.
3. Establish an immutable transaction-to-restaurant binding. The present mutable
   subscriber attribute alone is not sufficient to prove the intended restaurant
   under concurrent checkouts or delayed delivery. Investigate a server-issued
   purchase intent plus transaction verification/claiming before choosing the exact
   contract. Do not silently attribute an ambiguous purchase to a different listing.
4. Add a private, server-only ledger and atomic database fulfillment. Deduplicate
   both event IDs and store transaction identities; retries can otherwise double
   extend windows if the same store purchase appears in a different event.
   Lock the restaurant so distinct concurrent renewals stack rather than overwrite.
   Resolve authoritative days/kind server-side, verify the current owner and active
   account, and atomically update the window and ledger. Client display prices are
   never charge authority. The store provides the localized charge.
5. Select sandbox versus production explicitly and validate the app/store/product
   and transaction fields. Keep unknown/malformed events separate from transient
   failures. Add rollback-only database and mocked webhook tests for duplicate
   delivery, concurrent renewals, wrong owners, deleted/banned/pending accounts,
   malformed/unknown products and network retries before deployment.
6. Obtain explicit approval for server credential configuration, deployment and
   RevenueCat routing changes. No credential belongs in Expo public environment
   variables or the source repository. Run a sandbox device purchase only with
   separate authorization; no real charge is part of migration tests.

## Audit risks in the legacy code to avoid carrying forward

- `appwriteGetDocument` returns null for *any* non-2xx response, not just 404.
  Some backend outages can therefore be acknowledged as missing data instead of
  retried. The new implementation must distinguish temporary failures.
- The existing ledger and restaurant write are separate network requests, and
  event-ID deduplication alone does not prove transaction uniqueness. Different
  purchases calculated concurrently from the same expiry can lose one extension.
- Current catalog override handling only checks product ID and numeric days.
  The new catalog mutation checks bounds, integer days and product ambiguity.
  The future fulfillment resolver must validate independently as well.
- Refund/cancellation handling is absent: only one-time purchase events are acted
  on. Define the desired reversal policy before claiming complete payment parity.

References checked against the official documentation:
[RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks),
[event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields),
[customer identity](https://www.revenuecat.com/docs/customers/user-ids),
[Supabase database functions](https://supabase.com/docs/guides/database/functions),
[Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Disabled foundation applied and tested on 2026-10-12

Migration 25 was applied with approval to test project `ezhnntopskzlhllljbdv`.
It adds private routing settings,
restaurant-specific purchase intents, a server-only ledger and atomic fulfillment.
The settings start disabled with no RevenueCat project or allowed apps configured.
Client code can prepare/read its own intent only, not submit verified proof or
grant paid days. No store SDK calls or new HTTP route were added in this phase.

The intended verifier uses RevenueCat v2's
[one-time purchase search](https://www.revenuecat.com/docs/api-v2/purchase)
by exact store transaction ID and loads the corresponding
[product](https://www.revenuecat.com/docs/api-v2/product).
The isolated pure helper checks a unique result, exact current/original buyer,
owned purchased status, quantity one, allowed app/store/environment, consumable
product and store identifier, and purchase time inside the intent's purchase
window (five-minute clock tolerance). It rejects aliases, transfers, ambiguous
or continued search results, unsafe numeric IDs and approximate correlations.
This is conservative: alias/transfer or canonical-identifier differences will
need support/device verification rather than automatic fulfillment.

The existing installed native SDK returns a transaction object, but exact
Android/iOS store ID correlation has NOT been tested on a phone. A staged local
endpoint and checkout implementation now provide trusted fetching, bounds,
timeouts and durable client submission. Restricted RevenueCat v2 credentials,
deployment and real sandbox correlation remain pending. Pure fixture tests do
not prove a real store transaction.
Do not wire checkout into screens or enable payments before those steps pass.

The private ledger deduplicates RevenueCat purchase IDs and store transaction
identities; restaurant-row locks serialize paid-window updates. Snapshot plan
terms are taken at intent creation. Buyer status and current ownership are
checked again at first fulfillment. Idempotent retries return the recorded grant
without extending it again. Financial transaction identifiers are retained to
prevent replay; account/restaurant UUID links are nulled on deletion, while
unfulfilled intents cascade away. Define production retention/refund policy
before launch; this foundation does not implement refunds or RevenueCat customer
deletion. Rollback-only database contract tests passed with fake proof, including
deduplication, retries, renewal stacking, private status reads and buyer/owner
checks. A separate read-only audit confirmed private permissions, disabled settings
with no configured project/apps and zero remaining synthetic fixtures. Concurrent
stress, real RevenueCat verification and physical-device tests remain pending.

## Staged verifier and checkout prepared on 2026-10-12

`verify-purchase` is LOCAL and NOT deployed. Supabase platform JWT validation
and network `getUser()` check protect the endpoint; the active-account status
RPC precedes private buyer-filtered intent reads. A service-only budget RPC
limits upstream verification across isolates. Migration 26 and rollback/audit
tests for that budget are local, NOT applied or run. Fixed windows allow 30
project and 5 buyer attempts/minute. Counters contain only UUIDs/timestamps/counts
and cascade with profile deletion; they never contain receipts or Auth tokens.

HTTP input contains only `intentId` and `storeTransactionId`, not buyer, product,
restaurant, days, URL or verified proof. GET calls go to the fixed RevenueCat v2
origin with redirect following disabled. The request is capped at 2 KiB and
each upstream response at 128 KiB, including streamed bodies. Reads/fetches have
8-second bounds. Empty search results return pending; upstream failures and DB
uncertainty return safe retry errors. Verification rejects mismatched aliases,
transfers, canonical identifiers, quantity, ownership, environment and products.
Only independently fetched minimal proof reaches atomic fulfillment. No raw
upstream response, JWT or credentials are returned/logged. See official
[purchase search](https://www.revenuecat.com/docs/api-v2/purchase),
[product read](https://www.revenuecat.com/docs/api-v2/product) and
[Supabase function authentication](https://supabase.com/docs/guides/functions/auth).

The staged singleton coordinator records intent/buyer/restaurant/product before
opening the native store, then saves the exact returned transaction before any
server submission. It never equates store confirmation with fulfillment. A
pending record blocks another purchase and retries only status/submission. A
crash during the store operation, malformed receipt or uncertain store failure
requires explicit recovery with an exact transaction identifier; there is no
automatic repurchase. Recovery must be integrated/tested against store history
before release. Receipt-storage failure retains the result in memory and keeps
the pre-charge marker on disk; storage loss/reinstall is not solved by this local
journal and needs server/store recovery. Never silently clear uncertain journals.

Supabase UUID identities and native operations are serialized within the staged
singleton. Identity is checked again after offering lookup, immediately before
purchase; submission uses a network-verified pinned caller token and 30-second
invoke timeout. Logout denies new operations without calling RevenueCat logout,
which creates an anonymous identity. A later account explicitly logs in as its
UUID. Old-user receipts are saved under that account and never submitted as a
different user. The current Appwrite SDK wrapper must not run concurrently with
this staged singleton; integration must switch explicitly and restart/initialize
the native lifecycle. Official [identity guidance](https://www.revenuecat.com/docs/customers/identifying-customers)
supports explicit known identities without anonymous logout.

Future activation requires the master `PAID_FEATURES_ENABLED=true` plus ALL three explicit gates: Expo
`EXPO_PUBLIC_SUPABASE_PAYMENTS_ENABLED=true`, server
`PURCHASE_VERIFICATION_ENABLED=true`, and private DB settings enabled with an
allowlisted project/apps/environment. NONE were set in this phase. The server
secret `REVENUECAT_V2_READ_SECRET` requires only
`customer_information:purchases:read` and `project_configuration:products:read`;
it must never be an Expo public variable or enter the repository. Secret setup,
deployment, payment activation and sandbox purchases each require explicit
approval. No webhook was switched. Refunds, RevenueCat customer deletion,
production retention, concurrency stress and physical-device regression remain
pre-cutover requirements.

Mocked verification/checkout tests pass (249 app-service/auth tests, 47 Deno
purchase tests). These do not prove real charges, store identifier correlation,
SQL budget behavior, credential validity or deployed endpoint operation.
