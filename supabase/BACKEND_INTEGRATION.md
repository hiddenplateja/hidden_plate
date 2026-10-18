# Test-only app integration

Current status (2026-10-17): the user confirmed the Android phone checklist:
email/Google signup, OTP, password reset and new-password login, push delivery,
restaurant/photo submission, admin approval, Home/search/map/details, reviews and
photos, collection ratings, saves, follows/likes/comments/blocks, community posts,
account switching/restart and disposable-account deletion. Normal development,
preview and production configurations now select Supabase + R2, with test mode
disabled; `preview-supabase` remains a compatible internal test profile. Appwrite
is retained only as an explicit legacy fallback, not automatically selected on an
error. Production rejects test mode and malformed configuration. Payments remain
disabled. A production-mode local bundle is not a store submission or approval.
The user's current email sender/domain is for live testing; replace/verify its
SPF/DKIM/DMARC and retest delivery before launch. See
[Android preview testing](ANDROID_PREVIEW_TEST.md) and the latest stage below.
Earlier dated sections record the state at that time, not the current gate.

## Default backend cutover and source review — 2026-10-17

- Authorized after the user completed the listed Android checks, including
  password reset email/code and signing in with the replacement password. The
  email was initially in Spam; the current sender domain remains test-only.
- Normal development, preview and production EAS profiles explicitly select
  Supabase with test mode false and the same public Supabase/R2 values tested on
  the phone. Public source defaults support local startup without ignored dotenv
  files. A missing selector no longer silently picks Appwrite. Explicit Appwrite
  selection remains available; failed requests never switch backend. The
  immutable session/cache/credential fences remain in place.
- Production now accepts validated normal-mode Supabase but rejects test mode,
  unknown builds, malformed origins and privileged keys. Tests cover actual
  facade/registry/port routing for all four profiles. Media defaults no longer
  depend on a legacy Appwrite email endpoint. No server security policy changed.
- Verification: 645 targeted tests in 51 suites, TypeScript, changed-code lint
  and staged whitespace checks pass. The existing R2 Worker passes 40 tests in
  two suites (local runtime warns it falls back to its supported compatibility
  date). Production-mode Android export passes: 4,556 modules, 106 assets,
  12.3 MB. These checks do not submit a store build or establish iOS coverage.
- Source review found no private-key/provider-secret/privileged-or-session-JWT
  matches in the candidate source tree. Local dotenv, Supabase CLI state,
  generated client bundles, `.claude` settings and one-off staging scripts are
  excluded from the migration commit. The schema snapshot is schema-only, not
  user data; its webhook credentials were excluded when captured.
- AST comparison confirmed unchanged StyleSheet definitions and visible JSX
  text in all 13 modified screen/provider files against the previous commit.
  The React Native/Expo skill kept native package versions pinned (AsyncStorage
  remains 2.2.0) and avoided a presentation redesign or native dependency upgrade.
- Payments/subscriptions remain off; migration 26 and store/payment activation
  remain deferred. This source/configuration cutover starts no EAS build, server
  deployment, store submission, role assignment or message. Future launch work
  includes the final sender domain/authentication/delivery check, release/iOS
  testing and any desired durable offline query-cache design.

## Google signup relationship handling — 2026-10-17

- Hosted inspection found Google-created profiles still carrying server-owned
  pending-signup rows while the app allowed onboarding. `auth_signup_pending`
  has a primary-key foreign key to profiles: PostgREST embeds it as an object or
  null, not the array assumed by the original auth/OAuth checks.
- Both checks now use one SDK-free, identity-checked decoder. A matching object
  or legacy one-row array is pending; null or an empty array is completed.
  Missing, malformed, multiple or mismatched rows fail closed. Pending accounts
  cannot restore a completed app login or receive client admin/onboarding state;
  Google sign-in sends them through the existing username picker and the
  existing `finish_auth_signup` RPC before onboarding. Completed accounts no
  longer dereference `.length` on null.
- Regression coverage uses real object/null shapes as well as legacy arrays.
  All 640 targeted tests in 51 suites pass with open-handle detection;
  TypeScript and changed-file lint pass. Supabase-selected Android Metro/Hermes
  export passes (4,555 modules, 106 assets, 12.3 MB). Phone validation still requires a new
  `preview-supabase` APK: sign out of the stuck flow, sign in with Google again,
  finish username selection and then complete onboarding.
- The React Native/Expo skill kept the correction in pure/service logic: no UI,
  routes, styles, dependencies, RLS weakening or manual pending-row removal.
  Existing Google accounts can retry without deleting/recreating their account.
  No build, push, commit or deployment was initiated by this fix.

## Android push registration compatibility fix — 2026-10-16

- Device feedback confirmed email signup/verification succeeds, but notification
  enablement fails. The hosted push-token table was empty during inspection; no
  test push was sent because there was no registered destination.
- Reproduced `TypeError: AbortSignal.timeout is not a function` using the
  `abort-controller` implementation installed by React Native 0.81's `setUpXHR`.
  Registration used that unsupported static method before starting its RPC and
  caught the exception as a null result. This is a confirmed compatibility bug;
  it does not rule out an additional permission/FCM issue on the phone.
- Replaced all seven production call sites (push registration/logout cleanup,
  saves and badge sync) with `withRequestTimeout`: AbortController plus a timer
  cleared in `finally`. Original 5-second/1.5-second deadlines, pinned credentials,
  owner filters, errors and account-transition checks remain unchanged.
- The push suite now runs against the actual React Native AbortController/Signal
  package, without `AbortSignal.timeout`. Helper tests exercise abort deadlines
  and timer cleanup on success, rejection and synchronous failure. All 621
  targeted tests in 50 suites pass with open-handle detection; TypeScript and
  changed-file lint pass. Supabase-selected Android export passes (4,554 modules,
  106 assets, 12.3 MB). Native delivery still needs a rebuilt APK/device test.
- React Native/Expo skill guidance kept the fix compatible with the installed
  runtime without a global polyfill or dependency upgrade. No UI/design,
  permission policy, backend schema, deployment or payment setting changed.
  Rebuild with `preview-supabase`, install/open/sign in and retry notification
  enablement; verify a token before sending a single user-authorized test push.

## Foundation — 2026-10-13

Status: staging foundation, **not enabled**. Live providers/screens still use
Appwrite. No EAS profile/environment values, UI/design, hosted backend settings,
payment configuration or deployments changed in this stage.

## Prepared

- `backendTestConfiguration.ts`: explicit Supabase + exact test-mode opt-in,
  development/preview-only validation, strict credential-free HTTPS DNS origins,
  public-key-type validation (modern publishable or legacy anon, not signature
  validation), credential-free project cache namespaces. Appwrite remains the
  default. The future app selector rejects Supabase while
  `SUPABASE_APP_INTEGRATION_READY=false`.
- `supabaseTestBackend.ts`: typed, lazy, retryable gateway for 28 non-payment
  staged service modules. Gateway construction initializes neither SDK and
  requests no native permissions. It is an integration harness, not a completed
  screen-service replacement. Literal imports are discoverable by Metro; actual
  release-bundle behavior is not yet tested.
- `supabaseScreenPorts.ts`: original function names with compile-time parameter/
  result compatibility for all 13 review functions, seven user I/O functions,
  four restaurant read functions and two admin functions. No value import of
  their legacy Appwrite implementations. Error-class compatibility and pure
  validators are deliberately not claimed by these ports.
- `backendAccountScope.ts`: project/backend/account cache keys, synchronous
  visible-state/cache clearing, serialized cancel/remove barriers, read aborts,
  generation checks, guarded synchronous result publication, recovery after
  cleanup failure and disposal. This is not yet attached to a provider. It does
  not pin write credentials or replace server authorization.
- Source-graph regression test checks value-import reachability from both gateway
  and ports: no Appwrite SDK/client or payment SDK/services. Type-only imports
  are excluded. This is not a final-bundle audit.

## Screen-contract mapping stage — 2026-10-13

- `supabaseTestScreenServices.ts` provides a typed, lazy registry for 28
  non-payment screen-service groups, backed by 30 staged module domains. Includes
  auth/password/OTP/OAuth, user/admin/restaurant/review, storage, saves/badges,
  follows/blocks/collections, community/likes/comments/inbox/device tokens,
  preferences/moderation/claims/owner tools/config and account deletion.
- Original-name ports are compile-time checked against the legacy public
  functions, including synchronous image helpers, validation, menu codecs,
  feature flags and constants. The old constructor exports are not copied;
  exception compatibility must be reviewed when actual facades are connected.
- Saves retain string-or-null status and saved-document/restaurant pairs using
  opaque composite UI identifiers. Unavailable listings stay `restaurant=null`.
  Combined-list previews sort across three buckets and apply the final limit;
  larger lists use bounded paging. Request-local verified credentials pin these
  reads/writes and reject replaced-session results. Atomic server saves enforce
  visited/want-to-go exclusivity; no follow-up client exclusivity writes.
- Badge sync uses private, pinned preferences, preserves silent legacy baseline
  initialization, serializes within this app instance and suppresses stale or
  unpersisted celebration results. Cross-device deduplication is not proven.
- Supabase email confirmation is a read-only Auth-proof assertion, not a
  client-controlled verified flag. Signup proof still uses the existing staged
  pending-account OTP flow; completed accounts cannot finish through that flow.
  The old completed-but-unverified re-verification screen and Apple provider
  availability are not device-tested by these mappings.
- Device registration checks the legacy provider-supplied user ID against the
  current account before permissions/registration. Cleanup captures exact account
  identity; arbitrary or stale user IDs cannot clear another account's token.
- Client notificationTriggers/dedupe are deliberately not mapped: database
  functions create/dedupe notifications without querying other users' inboxes.
  The obsolete `ensureOwnerMenuDoc` helper is omitted: claim approval already
  seeds/grants owner menus atomically. Listing-payment mutation is omitted too.
- Shared compression/profile-validation/menu-codec helpers were extracted and
  re-exported from their legacy services. Existing dimensions, quality, MIME,
  limits, messages, normalization and menu parsing behavior remain unchanged.
  No UI/design files or provider routing were edited. The native skill kept
  existing dependencies/settings and explicit native initialization boundaries.
- All 407 targeted service/auth/shared-helper tests in 37 suites pass. TypeScript
  and changed-file lint pass. Source-import isolation still passes; actual Metro
  preview/release bundles, native permissions, SMTP/OAuth, R2/push and physical
  devices have not been exercised. No live Supabase/Cloudflare mutation or build
  environment change occurred. Readiness remains false; Appwrite remains active.

## Connected facade/provider staging — 2026-10-13

- All 28 existing service entry points are now lazy backend-selecting facades.
  Appwrite bodies were preserved in `src/services/legacy`; 22 error constructors
  moved into an SDK-free shared module, keeping error identities/messages.
  Explicit type-only exports and synchronous helpers retain the public API.
- Appwrite configuration is read without initializing its SDK and constructed
  only when needed. Selecting Supabase never falls back to Appwrite. Obsolete
  client notification/menu-permission/payment-only operations explicitly reject
  on Supabase. Disabled pricing readers no longer eagerly initialize Appwrite.
- EAS profiles now carry a non-secret development/preview/production build label;
  no backend/test-mode flags, credentials or remote EAS variables were changed.
  The selector is immutable per app instance. Production/unknown labels remain
  blocked from Supabase test activation; readiness is still false.
- AuthProvider has a guarded Supabase branch with bounded restoration, verified
  snapshot subscription/native refresh lifecycle, stale refresh/event/disposal
  protection, banned-account sanitization and serialized user auth actions.
  The existing Appwrite provider body is preserved in its default branch.
- Supabase children have fresh account-transition query clients and remount
  boundaries for local screen/inbox/badge state. Old clients clear/cancel on
  identity change/unmount. Supabase uses memory-only caching at this stage,
  never the existing shared Appwrite disk cache. Appwrite keeps its original
  persistence options. Restaurant-detail optimistic writes now use the nearest
  query context instead of a global client; no visual/layout code changed.
- The local last-OAuth shortcut keeps Appwrite's existing key and intentional
  logout behavior; Supabase keys are isolated by backend/project. It contains
  display metadata, never tokens, and is not a verified auth snapshot.
- All 448 targeted tests in 40 suites pass, including lazy facade imports,
  routing/error/public-function coverage, snapshot races/reactivation and OAuth
  metadata partitioning. TypeScript/lint/whitespace checks pass. Local Android
  Metro/Hermes export succeeded (4,546 modules, 106 unchanged assets). Generated
  bundles are ignored and contain client configuration; do not publish them.
- This is NOT an APK/EAS preview, phone test, mounted-provider test, hosted
  mutation, service credential setup or cutover. Native login/Google/Apple,
  uploads/push delivery and screen transitions remain unproven. Remaining
  credential-sensitive writes need a final account-switch audit before activation.
  Durable Supabase offline persistence and its hydration/writer teardown are not
  implemented. The source skill kept SDK loading/lifecycle/cache boundaries
  explicit and left presentation/styles/assets alone. Payments remain deferred.

## Test-build prerequisites recorded at the facade stage (historical)

1. Run an integrated Supabase preview-readiness smoke test and prepare an
   explicit opt-in test-build configuration. The request and mounted lifecycle
   tests below are not a native router/OS/device proof. Exercise the guarded
   compression/upload/save handlers, delayed confirmations and notification
   cold starts on the physical device; confirm SMTP/OAuth, Edge Functions and
   media authorization against the test project before any backend switch.
2. Test durable account/project-scoped offline persistence separately if required
   before launch. Detach old subscriptions and stop throttled writes before
   removal/hydration; deletion alone is insufficient. The Supabase test path is
   currently memory-only and must never hydrate the Appwrite shared cache.
3. Keep the guarded selector/build classification explicit. These public
   build flags are accidental-activation safeguards, not authorization controls.
   RLS and server-checked functions remain responsible for authorization. Do not
   set the integration-ready constant or add Supabase test EAS variables until
   coordinated routing, cache hydration and contract checks are complete.
4. Verify a real preview build and physical Android device: startup/offline/restart,
   email/Google login, profile/admin, map (2,000 requested), public collection
   ratings, reviews/community/saves/blocks, R2 uploads/deletion, inbox/push,
   logout/account switching and deletion. Hosted services/device behavior is not
   proven by unit tests or the isolated SQL restore.

Payment migration 26, purchase-verifier deployment and all checkout/store work
remain deferred. No subscriptions or payments are part of this launch.

## Mounted lifecycle and sensitive-request audit — 2026-10-13

- Added 12 mounted tests of the real AuthProvider Supabase branch, including its
  module cycle, startup failure, delayed restoration/refresh, account changes,
  sign-out cancellation, cache isolation, local child remounts, banned accounts,
  transient refresh errors, strict-effect replay, subscription teardown, lazy
  load disposal and concurrent-action guards. The renderer is an exact React
  19.1.0 development dependency, not an app runtime dependency. It is
  [deprecated by React](https://react.dev/warnings/react-test-renderer); these
  focused tests supplement, rather than replace, native integration tests.
- Logout/OAuth completion now refreshes authoritative identity instead of
  unconditionally clearing a potentially newer account. Auth subscriptions also
  synchronously invalidate on raw identity changes during startup, before their
  first deferred profile load. SDK work remains outside the synchronous
  [auth callback](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
- Query retirement captures/cancels old queries before clearing and destroys
  detached query objects after settlement. A regression test verifies that a
  cancelled fetch cannot leave a detached 24-hour garbage-collection timer.
- Profile updates no longer install/copy refresh tokens into temporary clients.
  Profile updates and private settings reads/writes verify the captured access token, use a
  request-local client with a fixed authorization header and check exact
  account/token identity before writes and before publishing results.
- R2 upload/delete/cleanup requests pin one verified account/token. Upload paths
  and credentials cannot come from different accounts; local-file delays cannot
  adopt a later login. Cleanup batches reuse the original token and stop on a
  switch. Remote requests have a 30-second abort deadline; actual upload body
  size is validated. A completed server write is not rolled back merely because
  the client discards its response after an account change.
- The React Native/Expo skill influenced lifecycle teardown and account-scoped
  state handling. No presentation/styles/assets were edited in this stage.
- Verification: 473 targeted tests in 42 suites pass, with normal Jest exit and
  open-handle detection enabled. TypeScript, changed-file lint and whitespace
  checks pass. Local Android Metro/Hermes export succeeds (4,546 modules,
  106 assets, 12.3 MB bundle). This export is not an EAS APK or device test.
- Integration readiness remains false, Appwrite remains the default, payments
  remain disabled, and no hosted schema/deployment, real user action, email,
  notification or preview-build backend switch was performed.

## Inbox/admin and lazy-loading session audit — 2026-10-13

- Added a credential-free, SDK-free transition-ticket module. The real shared
  Supabase client records identity/token changes synchronously in one observer
  for the client's module lifetime, without SDK calls inside its auth callback.
  Repeated unchanged events are harmless; sign-out/re-sign-in (even as the same
  user) and token rotation invalidate earlier tickets. Isolated proof clients
  do not publish transitions into the shared application fence.
- Non-auth facade calls capture a ticket before both lazy awaits, check it
  before invocation and discard late results after transitions. Auth actions
  intentionally establish/remove sessions. Account deletion still checks before
  invocation, but its existing adapter may intentionally sign out at completion.
  No Appwrite fallback or new eager native/backend SDK import was introduced.
- Added an explicit data-request helper: verify the captured JWT on an isolated
  client, check the transition ticket plus exact current user/token, set a fixed
  Authorization header, and recheck after the request. No refresh token is
  installed, refreshed or revoked by this helper. Client fences prevent accidental
  account adoption; database functions/RLS still enforce server authorization.
- Inbox read/delete/read-all, unread counts, compatibility push writes and inbox
  pages use pinned credentials. Recipient filters are retained, pages reject
  wrongly addressed rows, and signed-out tolerant reads stay empty/zero. Stale
  count replies and negative/fractional values do not update the badge.
- The shared moderation/report/claim/menu/spotlight command and admin queue
  readers now use the helper. Admin role/stats, user browsing/ban, restaurant
  create/edit/approve/delete/ownership/search, config patches and claim submission
  use request-local credentials. Legacy payment-plan patches remain deferred and
  excluded from the non-payment gateway.
- Bulk import captures one verified admin before checking role/geocoding and
  reuses that identity for all row writes. A transition stops the import instead
  of continuing as a replacement account. Previously completed writes cannot
  be undone by the client. Claimed-list paging pins one account across pages;
  optional image cleanup receives the deletion request's original identity.
- Payload-only tests are explicitly separate from credential tests. The new
  race suite exercises real request helpers and adapters with mocked network
  responses; the client-wiring test exercises the real observer installation.
  The React Native/Expo skill kept this stage within session/backend boundaries;
  no UI/design, native dependency, EAS environment or hosted data changes.
- Verification: 498 targeted tests across 44 suites pass with open-handle
  detection and normal exit; TypeScript, service/test lint and whitespace checks
  pass. Local Android Metro/Hermes export succeeds (4,548 modules, 106 assets,
  12.3 MB bundle); this is not an EAS APK or physical-device test. Readiness
  remains false, the app still selects Appwrite, and payments remain disabled.

## Community/content request audit — 2026-10-16

- Review/post/comment/like/follow/block/save/collection/owner-reply writes and
  public restaurant submission now use the fixed-token data-request helper.
  Review deletion uses the original verified client's Authorization header;
  database owner/admin policies still decide deletion permission. No caller ID,
  parent, moderation field or counter was added to trusted payloads.
- View recording/counts use verified request-local credentials while preserving
  their non-blocking empty/zero behavior. OAuth username completion also pins
  its pending account, rejects transitions and verifies the returned user ID.
  No auth session is installed/refreshed/revoked by these data helpers.
- Added a generic pinned REST reader and member-only page collectors. Community
  review/post/comment feeds, liked-content tabs, saved/hidden/blocked/follow/
  collection pages, current-user decorations, profile statistics/discovery and
  private report/claim lookups no longer adopt a later caller. Full lists reuse
  one proof/token across every internal page rather than verifying a new account
  for each batch. Partial results are discarded on a transition.
- Collection hydration checks its original account again after restaurant/rating
  lookup. Existing ordering, unavailable-listing handling and real rating merge
  are unchanged. Public restaurant paging (including 2,000 map rows), public
  restaurant-review paging, public rating aggregates and publicly readable
  profiles/replies keep their existing anonymous-read contracts.
- Payload/mapping tests use an explicitly named contract-only fixture; they are
  not authentication evidence. Real-helper tests exercise 19 mutation paths
  with success, transition-during-proof and late-response cases, plus review
  deletion, non-blocking views, 2,001-record lists, switches between pages, partial
  liked batches, private collection hydration and OAuth completion races.
- Verification: 569 targeted tests in 45 suites pass with open-handle detection
  and normal exit. TypeScript, changed-service/test lint and whitespace checks
  pass. Final Android Metro/Hermes export succeeds (4,548 modules, 106 assets,
  12.3 MB bundle). These are local
  mocked-network tests, not hosted writes, native OAuth/push delivery tests or an
  EAS preview. The React Native/Expo skill kept request/session work isolated from
  presentation and retained lazy service boundaries; no UI/design/assets or new
  dependencies were changed in this stage.
- Appwrite remains active, integration readiness is false, and paid features are
  false. No hosted SQL, real account, role assignment, R2 object, notification,
  environment variable or deployment was changed. Payment migration 26 and
  payment-plan/purchase operations remain deferred and outside the test gateway.

## Multi-step actions and notification lifecycle — 2026-10-16

- Added a credential-free action ticket and React lifecycle hook for the guarded
  Supabase path. Tickets bind the originating owner, session revision and mounted
  generation. They fail before/after async steps and remain invalid across
  Strict Mode replay or logout/re-login. Token rotation stops writes but still
  permits the same mounted owner to reset a busy flag. Appwrite gets a passthrough
  ticket, keeping the live backend's existing behavior.
- A shared photo pipeline preserves compression/upload order, existing progress
  messages and normal partial-failure cleanup. Account/screen changes stop the
  pipeline before the next upload/save and never delete old files using the new
  account. An already-finished upload/write cannot be rolled back by the ticket;
  unattached images can remain after cancellation and need authorized cleanup.
- Wired the composer, profile/avatar save, review/photos/badges, restaurant form
  and admin spotlight flows. Their cleanup, preferences, follow-up refreshes,
  success/error alerts and navigation are guarded. Restaurant create/edit/delete
  wrappers and delayed confirmation buttons also retain their original ticket.
  This stage changes handler logic, not layout, styling, assets or visible copy.
- Supabase has a scoped NotificationProvider with the existing context contract.
  It discards stale inbox/push-registration results, makes the newest refresh win,
  retains functional state updaters and cleans up both native listeners. The
  previous Appwrite provider body is preserved unchanged (ignoring line endings).
- Push events are verified by notification ID through the original caller's
  owner-filtered, pinned REST read. Existing active-account/blocked-actor RLS is
  the same as inbox paging/counting. Wrong-user, missing, malformed, stale or
  inaccessible events cannot route, bump counts or show Supabase foreground
  banners. Links use UUID targets from the verified inbox row, not raw payload
  paths. Receipts refresh exact unread counts instead of blindly incrementing.
- Verification has a bounded 1.8-second wait, within Expo's
  [notification-handler response budget](https://docs.expo.dev/versions/latest/sdk/notifications/).
  The installed expo-notifications source was also checked. Cold-start responses
  are verified and deduplicated against live taps; handled startup responses are
  cleared. These controls cannot retract notifications already queued/displayed
  by the OS in the background; native background/terminated delivery needs device
  testing. No real push was sent and no server payload/deployment was changed.
- Verification: 610 targeted tests in 48 suites pass with normal exit and
  open-handle detection. New tests exercise real mounted provider/hook behavior,
  strict replay, old callbacks, delayed results, refresh ordering, cold-start
  deduplication, verification deadlines, account-safe upload sequencing and RLS
  query construction with mocked network/native modules. They are not full
  rendered-screen or physical-device tests.
- TypeScript and changed-code lint pass. Final Android Metro/Hermes export passes
  (4,553 modules, 106 assets, 12.3 MB bundle); no EAS APK was built. AST-based
  checks confirmed unchanged StyleSheet definitions and visible JSX text in all
  eight touched screens/forms, plus the unchanged Appwrite notification body.
  The React Native/Expo skill guided functional updates, minimal non-render state
  and lifecycle disposal. No visual redesign or new dependency was introduced.
- Appwrite remains selected by default; integration readiness and paid features
  remain false. No hosted schema, real user/role, storage object, message, push,
  environment variable or deployment was changed. Next work is the integrated
  opt-in preview readiness/configuration, followed by explicit device testing.

## Opt-in Android preview configuration — 2026-10-16

- Added `preview-supabase` to `eas.json`, extending the existing preview while
  explicitly choosing a standalone internal Android APK, preview build class,
  Supabase backend and exact test-mode opt-in. Its URL, public publishable key
  and R2 Worker URL are explicit profile values, so ignored local dotenv files
  are not required for these settings on the cloud builder. No server secrets
  are present. Existing development/preview/production profiles were unchanged
  in this stage and still default to Appwrite.
- The coordinated integration readiness gate is now true for test activation.
  This is not production readiness: missing test opt-in/configuration still
  fails closed, production/unknown build classes still reject Supabase, and
  backend selection remains fixed for each app instance. Paid features remain
  false; payment migration 26 and payment/store setup remain deferred.
- Verified the actual EAS-resolved profile and public values without logging
  them. New tests cover standalone APK/profile boundaries, default Appwrite
  profiles, production rejection and real selector/runtime/facade/registry/port
  routing with only endpoint modules mocked. This routing test is not a native
  SDK or live database write test.
- All 618 targeted tests in 49 suites pass with open-handle detection and normal
  exit; TypeScript, changed-code lint and whitespace checks pass. Android
  Metro/Hermes export using the new profile's environment passes (4,553 modules,
  106 assets, 12.3 MB). This is not an APK or physical-device startup test.
- Read-only hosted checks returned HTTP 200 for public startup configuration,
  anonymous restaurant reads and the R2 Worker's health endpoint. They do not
  prove authenticated access, image upload, SMTP/OAuth or real push delivery.
- The React Native/Expo skill kept native configuration/dependencies and all
  presentation unchanged. Only build/test activation, regression coverage and
  documentation changed. No hosted SQL, remote EAS variables, deployment,
  account/role, media object, email or push was changed/sent. No EAS build or
  submission was started. The next step is the explicit APK build and the
  [phone checklist](ANDROID_PREVIEW_TEST.md).
- Profile/environment handling follows the official
  [EAS build configuration](https://docs.expo.dev/build/eas-json/) and
  [environment-variable guidance](https://docs.expo.dev/eas/environment-variables/usage/).
