# Supabase migration status

Email follow-up (2026-10-20): separate welcome/security-email handling is
deployed with migration 28 applied and explicitly activated. The signed Send Email
hook, private welcome sender and one-minute bounded retries are enabled; password
security alerts remain enabled. Endpoint authorization/empty-queue checks pass,
but real signup/reset/password-change email delivery still needs device testing. See
[email delivery activation and rollback](EMAIL_DELIVERY.md) for the configured
setup, rollback steps and remaining hosted signup/reset delivery tests.

After the user's successful Android checklist (including password reset/login,
Google signup, push, media, admin, community and account deletion), normal
development/preview/production builds now use Supabase + R2. `preview-supabase`
remains an internal test profile. Production rejects test mode. Appwrite is kept
as an explicit fallback for rollback; it is not selected automatically on error.
Payments/subscriptions remain disabled. No UI/design changes are part of this
cutover. Store submission, new email-domain setup, iOS/device coverage and durable
Supabase offline query persistence remain separate work. See
[Android preview testing](ANDROID_PREVIEW_TEST.md) and
[integration history](BACKEND_INTEGRATION.md).

## Push backend (2026-10-05)

- `send-push` is deployed to project `ezhnntopskzlhllljbdv`.
- An INSERT-only database webhook, `notifications_send_push`, watches
  `public.notifications` and invokes it with the default server secret on `apikey`.
- Platform legacy JWT verification is off. `@supabase/server` explicitly requires
  secret-key authentication; publishable keys and user sessions cannot invoke it.
- Notification content is loaded from the database, not trusted from the webhook.
- Private per-device delivery rows use a two-minute claim lease and a five-attempt
  limit. The retry job checks every minute; an empty queue makes no HTTP call.
- Credentials are in Supabase's managed function environment and encrypted Vault,
  never in the mobile app or committed configuration.
- `accepted` means Expo accepted a ticket, not that the phone displayed it.
  Expo receipt polling is not implemented yet. Ambiguous network failures may
  result in a duplicate push; the delivery lease is not an exactly-once guarantee.
- Optional `EXPO_ACCESS_TOKEN` is required if Expo enhanced push security is enabled.
- Device registration and notification provider wiring are still pending, so
  physical Android/iOS delivery is not yet end-to-end verified.

## Verification

- Deno type-check passed:
  `npx deno check --config supabase/functions/deno.json supabase/functions/send-push/index.ts`
- Expo TypeScript passed: `npx tsc --noEmit`.
- Lint: zero errors, ten existing warnings.
- SQL tests in `tests/` run in transactions that roll back all fixtures and
  queued HTTP requests. Social event and push queue tests passed on the project.
- Live sender: server-secret invocation returned HTTP 200 with an empty queue;
  publishable-key invocation was rejected. No real device push was sent.

## Deployment notes

The initial table/type/RLS schema was created through the Dashboard. A secret-free
CURRENT-STATE recovery candidate was captured on 2026-10-13 in `baseline/` and
passed an isolated local restore test; it is not a complete hosted-service backup
or a migration-zero bootstrap. These numbered
migrations still do not bootstrap a blank database; do not replay 1-25 over the
current-state snapshot. See `baseline/README.md` for exclusions/prerequisites.
Never commit the webhook's literal credential arguments.

For the push setup, apply migration 09, deploy the function, create the authenticated
webhook in the Dashboard (notifications, INSERT, send-push, POST, 10,000ms timeout,
default secret API key), then apply 10 and 11. These import the webhook credentials
inside Postgres without emitting them in query results.

Remaining cutover work includes auth/session and email flows, complete admin and
community/moderation contracts, account/profile operations, device registration,
adapter pagination checks, security review, and physical-device regression tests.

## Auth/session preparation (2026-10-06)

- Native client configuration now includes the URL polyfill and process lock.
- Foreground/background refresh has one reference-counted listener with cleanup.
- Verified identity, profile, role and onboarding are loaded as one snapshot;
  delayed results from a previous account are discarded.
- The existing provider's startup now time-boxes the full role/preferences
  bootstrap, not only the identity request. It still uses Appwrite.
- Supabase event subscribers defer database work outside the SDK auth callback,
  suppress stale responses, and clean up on unsubscribe.
- Device-token registration/cleanup is staged; logout is device-local and token
  cleanup is best effort with a deadline. Providers still use Appwrite registration.
- Supabase preferences no longer initialize Appwrite, and updates preserve
  unknown stored keys. Atomic patching was completed in migration 18 below.
- Email signup now uses the isolated OTP/profile wizard described below.
  Do not wire it into the live provider before SMTP and templates are configured.
- Twenty new mocked auth/lifecycle/bootstrap/push-token tests passed; TypeScript passed.
  The full suite passed 72 tests; the unchanged reviewer-badge suite could not
  load its native icon dependency in the Node-only Jest environment.
- Remaining auth work: preserve the pre-signup OTP wizard, SMTP/templates,
  password reset/change, OAuth provider/redirect configuration and profile
  completion, and physical-device login/session/push tests. No live Supabase
  account signup or password reset was tested in this preparation step.

## Email/password/OAuth adapters (2026-10-06)

The live app still uses Appwrite. No screen markup, styling, or navigation design
was changed. The React Native auth guidance influenced the isolated session
clients and lifecycle cleanup, keeping verification/recovery out of the app session.

- Migration 12 was applied and its rollback-only SQL security test passed.
  `auth_signup_pending` is server-owned and readable only by its owner. The
  completion RPC binds to `auth.uid()`, requires a verified email and password or
  supported social identity, validates profile input, preserves preferences, and
  atomically clears the pending marker. Existing test accounts remain complete.
- New email identities are created provisionally at the email step. The user
  still sees email -> six-digit code -> profile/password. OTP proof is memory-only
  on an isolated client; restarting the app requires entering another code.
  Completed accounts cannot use the signup wizard to overwrite their password.
- Session restore excludes pending profiles, including first-time OAuth users.
- Password recovery uses `verifyOtp(type: "recovery")` on an isolated client,
  sets the password, and signs out locally. It never publishes a recovery session
  into the app. If a password write fails after consuming the code, resend it.
- In-app password changes independently check the exact old password using an
  isolated login, pin the password mutation to that account, and pass
  `current_password` to `updateUser`. The surviving session replaces the original
  app session only if the same account is still active. Enable server-side
  current-password enforcement before cutover;
  verify signup retries after username conflicts with that setting enabled.
- Native Google/Apple adapters use SHA-256 PKCE, validate the exact callback
  `hiddenplate://auth`, reject plain PKCE, and return the existing username-picker
  contract. Google is enabled in the Dashboard as of 2026-10-07; Apple remains
  disabled. Web OAuth is explicitly not enabled by these native adapters.
  No provider or device sign-in was tested.
- Expo Crypto was added for native random bytes and SHA-256 support. A fresh
  native build is required for device testing; this is not an OTA-only change.
- With the user's approval, live Email settings were changed to six digits and
  600-second expiry. Email confirmation stayed enabled.
- All 48 migration auth/session/push tests passed. TypeScript and lint passed
  (zero lint errors, ten pre-existing warnings). The full suite passed 100 tests;
  the unchanged reviewer-badge suite still cannot load native icons in Node.

### Required account setup before activation

1. Custom SMTP was configured by the user and verified after reloading the
   Dashboard on 2026-10-06. Resend host `smtp.resend.com`, port `465`, sender name
   `Hidden Plate`, and the enabled switch persist. No credential was read or
   copied; successful email delivery has not yet been tested.
   For the existing Resend account: host `smtp.resend.com`, port `465`, username
   `resend`, password = the Resend API key, sender = an address on its verified
   domain, sender name `Hidden Plate`. The current Worker sender is
   `noreply@nutinbutheat.com`; confirm that domain is still verified in Resend.
   The user must enter the credential directly
   in the Dashboard, not in chat or any `EXPO_PUBLIC_*` setting.
2. The three HTML templates in `email-templates/` were applied to Confirm signup,
   Magic link or OTP, and Reset password on 2026-10-06. Their saved previews show
   `{{ .Token }}` instead of a link, preserving the six-digit app screens. Subjects
   are `Verify your Hidden Plate email`, `Your Hidden Plate verification code`,
   and `Reset your Hidden Plate password`. Password-changed security emails were
   enabled and verified after a reload, replacing the previous Worker's
   best-effort alert when Supabase auth is activated.
   SMTP minimum interval is currently 60 seconds while the existing app's resend
   timers are 30 seconds; align the timers before cutover without changing layout.
3. Google was enabled by the user and its Enabled status was verified on
   2026-10-07 without reading the secret. The existing Google web client `ou`
   now includes `https://ezhnntopskzlhllljbdv.supabase.co/auth/v1/callback`;
   Google's save confirmation was observed, and the Appwrite callback is preserved.
   With the user's approval, the exact `hiddenplate://auth` redirect was saved
   on 2026-10-07. The Dashboard shows it as the sole allowlist entry; no wildcards
   were added and the default Site URL was not changed.
   Apple remains disabled; configure it if required. Provider secrets belong
   only in the Dashboard. Keep unused anonymous/manual-linking providers disabled.
4. Finish the remaining service contract migrations before wiring auth screens
   and AuthContext. Then test signup retries, abandoned signup resumption, reset,
   wrong old password, OAuth cancellation/returning/new users, app restart,
   account switching, admin role, and pushes on physical devices.

Primary references: [Supabase password flows](https://supabase.com/docs/guides/auth/passwords),
[native deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
and [Resend SMTP setup](https://resend.com/docs/send-with-supabase-smtp).

## Profile and user-admin foundation (2026-10-07)

- Migration 13 was applied to the test project with the user's approval. The
  audit found that the old owner-update policy allowed role/ban fields to be
  changed. Direct profile writes are now revoked except owner preferences;
  profile editing and ban/unban use bounded, caller-checked database functions.
- `is_admin()` now rejects banned and unfinished accounts. No real user's role
  was changed; provisioning admins remains a trusted Dashboard/server operation.
- Other users' profiles are read through `public_profiles`, an explicit public
  projection excluding role, preferences and auth email. Its owner reads through
  RLS; `security_invoker=false` and `security_barrier=true` were verified live.
  The base profile table is readable only by its owner or an active admin.
- `supabaseUsers.ts` stages ID/batch reads, profile edits, literal token-prefix
  search, suggestions, admin user pagination, and ban/unban. It keeps the existing
  User field names, including `avatarUrl` for an R2 path or HTTPS social photo.
  Batch reads are chunked below API limits. Suggestions omit self, banned and
  mutually blocked accounts. Unfinished signup profiles are not publicly exposed.
- Profile edits validate names/handles/bios, check username uniqueness in the
  database, accept only the caller's R2 avatar namespace or an HTTPS URL, and
  synchronize the auth display name without replacing other metadata. The
  temporary memory-only client pins the write to the captured session; an
  account switch cannot redirect the edit to a different user.
- Admin user browsing uses descending `(created_at,id)` keyset pagination with
  one extra row to detect the final page. Ban/unban is checked again in Postgres,
  prevents self-lockout, and clears registered push tokens on ban. This is an
  application moderation flag, not deletion or disabling the Supabase identity;
  audit remaining table/Worker write paths for banned-user enforcement before
  cutover. Unban does not restore deleted tokens; the device registers again.
- Google username suggestions now use the public projection, not private
  profile rows. The existing signup-completion SQL test still passes.
- Verification: 20 new mocked tests; all 68 migration auth/profile/admin tests
  passed across ten suites. TypeScript passed; lint has zero errors and ten
  pre-existing warnings. Rollback-only live profile/admin tests passed, including
  self-promotion denial, private preferences, admin-only browse/ban/unban,
  validation, duplicate usernames, pending signup, tied-date pagination, and
  blocked suggestions. Cleanup check found zero temporary test accounts.
- Screens/AuthContext remain on Appwrite. This completes user-profile/admin-user
  foundations, NOT the complete admin workflow: moderation reports/bug reports,
  claims/ownership, menus, restaurant management and full dashboard stats still
  need parity. `getSupabaseAdminCoreStats` deliberately excludes unmigrated report
  counts and must not replace the full `AdminStats` contract yet. Preferences
  now use migration 18's atomic patching; username/display-name cooldown enforcement
  should be reviewed before activation. Physical-device flows remain untested.

Access-control references: [Supabase column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security)
and [database function permissions](https://supabase.com/docs/guides/database/functions).

## Reports, claims and owner menus (2026-10-07)

- Migration 14 was applied to the test project with explicit user approval.
  Four content-report queues and a bug-report queue are private to each reporter
  and active admins. Direct client inserts/updates/deletes are revoked; database
  functions derive caller identity and content parent IDs instead of trusting UI
  payloads. Duplicate reports are no-op successes.
- Review auto-hide is three distinct reporters, matching
  `appwrite-functions/send-notification/src/main.js`'s checked-in default. An
  Appwrite `MODERATION_REPORT_THRESHOLD` Dashboard override has not been checked;
  confirm it before cutover if exact deployed-config parity is required. Comments,
  posts and post comments remain manual moderation. Hidden/restored reviews
  update restaurant rating aggregates through the existing database trigger.
- Claim contact details and review metadata now match the existing app contract.
  Submissions require an active completed account, an active unowned restaurant,
  validated contacts and an owner/manager role. Pending duplicates are idempotent;
  rejected claims can be submitted again. Claimants cannot set approval status.
- Approval is atomic: stored claimant identity, restaurant ownership, the menu
  override, at least 30 days of listing grace, and approval metadata change in
  one transaction. Existing menu contents and longer paid periods are preserved.
  Conflicting owners cannot be overwritten. Repeated identical decisions are
  idempotent. Menu edits validate sections/items and check current ownership.
- Staged adapters: `supabaseReports.ts`, `supabaseBugReports.ts`,
  `supabaseClaims.ts`, `supabaseRestaurantMenus.ts`, and `supabaseAdminQueue.ts`.
  The full `getSupabaseAdminStats` now includes all report counts. Queue pagination
  uses descending `(created_at,id)` plus a lookahead row, not a UUID-only cursor.
  Server functions enforce active-admin permission for moderation, triage,
  dismissal and claim review. No real user was made an admin.
- Verification: 12 new mocked tests; all 80 Supabase/auth-session tests pass in
  11 suites. TypeScript passed; lint has zero errors and ten pre-existing warnings.
  Live rollback-only tests passed for private reads, restricted writes, duplicate
  reports, the three-reporter threshold, rating restoration, correct content
  parents, admin checks, atomic approval/conflicting ownership, menu preservation,
  wrong-owner denial, banned users, pending signups, pagination and report cleanup.
  The final live audit verified ten installed RPCs, threshold three, revoked
  direct report/claim/menu writes, no anonymous report access, and zero temporary
  test users or restaurants remaining.
- Screens and AuthContext still use Appwrite; no UI/design was changed. Restaurant
  admin CRUD/import/search rebuild/spotlight management and payment/storage cleanup
  parity remain next, followed by remaining permission audits and device testing.
  This is not a complete backend cutover or a physical-device verification.

Response-format reference: [PostgREST resource representation](https://postgrest.org/en/latest/references/api/resource_representation.html).

## Restaurant administration and spotlight (2026-10-07)

- Migration 15 was applied to the test project with explicit user approval.
  Direct client restaurant/config writes are revoked. Public submissions and
  admin create/edit now share server-side validation of parish, coordinates,
  tags, menu, opening hours, contacts and R2 image paths. Public submissions
  require completed active accounts and always land pending; they cannot set
  trust, ownership, rating or count fields. Their images must use their own
  uploader namespace. Admin operations independently recheck active-admin status.
- Edits whitelist fields, preserve slug/ratings/counts/ownership, normalize tags
  and Instagram handles, and regenerate the search haystack server-side. Missing
  create cover images default to the first photo. Composite RPC response arrays
  are handled correctly. ID hydration is deduplicated and chunked at 100 rows.
- `supabaseRestaurantAdmin.ts` stages create/edit/flags/approval, active/pending/
  all search and browse, claimed/owned lists, ownership and listing-expiry edits,
  database deletion, bulk imports and search rebuilding. Browse/search use
  descending `(created_at,id)` pagination, exact filtered totals and lookahead.
  The owners list follows all pages instead of silently truncating at 100.
- Admin ownership changes seed/preserve the menu override atomically. Current
  active owners can read their own inactive listings; former owners and other
  users cannot. Releasing ownership removes the owner-menu override. This does
  not grant owners general restaurant-edit or publishing permission.
- Imports retain curated active/verified defaults, Expo geocoding fallback and
  per-row error collection. No real geocoding request or device import was tested.
  Database deletion cascades related rows and clears a matching spotlight pin.
  Media deletion is still best-effort: the Worker correctly rejects an admin's
  attempt to delete another uploader's object. Trusted cleanup/reference checks
  and the Worker's DELETE/204 response fix remain pre-cutover work; no broad media
  delete permission was granted to the mobile client.
- `supabaseSpotOfTheDay.ts` stages reading/setting/clearing the restaurant/date/
  photo pin and retains the existing daily rotation and review-photo fallback.
  Inactive/stale pins cannot become the public spotlight. `spot_date` is a real
  database date; invalid dates fail. Pinning needs an active restaurant. Clearing
  resets all pin fields together. No purchase products or payment grants changed.
- Verification: 16 new mocked tests; 96 Supabase/auth-session tests pass in 13
  suites. TypeScript passes; lint has zero errors and ten pre-existing warnings.
  Live rollback-only SQL tests passed for direct-write denial, public pending
  defaults, validation, image namespaces, admin checks, partial edits, preservation
  of ratings/slugs, literal search, totals and tied-date pagination, ownership/
  menu transfers, inactive reads, spotlight set/clear and cascade cleanup. No real
  account was made an admin; fixture and maintenance writes were rolled back.
  The final audit verified seven installed admin RPCs, revoked direct writes,
  denied anonymous admin/private-validator execution, and zero temporary users
  or restaurants remaining.
- All services remain staged; no screen, layout or design edits were made. Before
  activation: fix public restaurant/review sort-aware pagination and the map's
  2,000-row retrieval under API caps, audit remaining service contracts (including
  owner replies, views, preferences and account deletion), finish trusted R2
  cleanup, and test auth/notifications/admin workflows on devices. The checked-in
  migration set still needs the original Dashboard baseline exported to bootstrap
  a completely blank database.

## Public pagination and trusted R2 cleanup (2026-10-07)

- Migrations 16 and 17 were applied to the Supabase test project with explicit
  user approval. Public restaurant/review paging now follows the selected sort
  plus an ID tie-breaker. JSON RPC pages have a 250-row bound and one lookahead;
  the staged adapter collects up to 2,000 map rows without relying on the API's
  default row cap. Search is literal, totals match filters, inactive rows remain
  protected by RLS, and paid-listing filtering follows the existing feature flag.
- Rating distributions and collection summaries aggregate all non-hidden reviews
  in SQL. Collection ID requests are deduplicated and chunked at 100. Review
  writes also accept PostgREST's composite-array response format.
- Database triggers enqueue removed restaurant/review/post/profile/config image
  references, including cascading deletions. Canonical Worker avatar URLs are
  normalized to keys; external provider photos are not R2 cleanup candidates.
  The private queue has no client read/write grants. Per-key locks and retained
  tombstones block new references/key reuse while deletion is in progress.
- Own-image DELETE requires an active account, uploader ownership and zero live
  references. Admin cleanup accepts only database-recorded unused-image jobs,
  not arbitrary submitted keys, with batches of 20 and five-minute retry leases.
  Shared candidates are cancelled when another reference remains. The Worker
  acknowledges deletion only after R2 succeeds and returns bodyless DELETE/204.
  Uploads are write-once and recheck retirement after PUT to cover cleanup races.
- Staged admin restaurant deletion now commits database deletion first, then
  opportunistically drains at most 200 jobs. A failed drain never reports the
  committed database operation as failed. Cleanup is not a scheduled service:
  expired jobs need a later admin drain/own-image retry; a maintenance runner is
  still needed for unattended retries and other removal workflows.
- Verification: 104 app-service/auth tests in 14 suites and 40 Worker tests pass;
  app and Worker TypeScript checks pass, and changed service files lint cleanly.
  Worker tests preserve the existing Appwrite email/payment routes. The local
  Worker test runtime warns that it falls back from the configured June 2026
  compatibility date to March 2026; real deployment/device testing still matters.
  Live rollback tests used 2,001 restaurants and 1,101 reviews to check paging,
  full aggregates, hidden reviews, queue privacy, shared images, foreign-key
  denial, lease ownership/retry, tombstones, avatar changes, cascade removal and
  pending-account denial. The audit found four paging RPCs, five media guards,
  enabled queue RLS, denied client queue/anonymous cleanup grants, and zero
  temporary users, restaurants, reviews or jobs remaining.
  The full-URL avatar fixture also passed after normalization was added. Live
  anonymous PostgREST paging/ratings requests succeeded, the existing Worker
  health endpoint returned 200, and the updated Worker dry-run bundle passed.
- Worker deployment completed on 2026-10-07 after the user reauthenticated to
  Hidden Plate account `cdd46b9c0c0555f0350335c53ea2e8ec`. Wrangler pins this
  account to prevent deployment elsewhere. Version:
  `910d7b2a-6dd6-4996-a975-c89ba9ab6a6d`, at
  `https://hidden-plate-pay.hiddenplate-ja.workers.dev`.
  All 40 Worker tests and the Worker TypeScript check passed again before deploy.
  Eight live smoke checks passed: health 200, cleanup requires login 401 and
  POST-only 405, nonexistent R2 media 404, deletion requires login 401, malformed
  path 404, payment webhook rejects missing authorization 401, and invalid email
  input rejects with 400. These checks did not send emails, transact payments,
  upload/delete real images or verify a real authenticated admin/owner session.
  No app screen, credential or binding changes were made during this deployment.
- Appwrite remains the active app backend. No UI/design changes were made.
  Before cutover, audit remaining contracts (owner replies, views, community
  pagination, profile image URL mapping, preferences and account deletion),
  export the original database baseline, arrange unattended cleanup retries,
  and verify auth, media, notifications and admin workflows on physical devices.

## Owner replies, views and settings (2026-10-09)

- Migration 18 was applied to the test project with explicit user approval.
  Replies are created/edited through caller-checked functions, derive their real
  review/restaurant parent, and check current ownership while holding the same
  restaurant row lock used by ownership transfers. Direct client writes are
  revoked. URLs remain allowed in owner replies, matching the existing contract.
- Public reads expose replies only for a visible, non-hidden review, a readable
  restaurant, and its current completed, non-banned owner. Former owners' replies
  stop displaying; former authors may still delete their own replies. Admins
  may delete replies but cannot edit as another author. Inactive listings remain
  readable only under the existing restaurant owner/admin policy.
- View records are private and deduplicated by `(restaurant_id,user_id)` even
  under concurrent inserts. Recording requires an active account and an active
  restaurant. Only current owners or active admins may request aggregate counts;
  clients cannot enumerate viewers. The old app uses counts only on the owner
  management screen. Analytics failures retain its non-blocking behavior.
- Preferences use a row-locked, validated JSON patch instead of a client-side
  read/merge/replace. Disjoint changes and unknown already-stored keys are
  preserved. Clients cannot directly update preferences; the RPC accepts only
  existing app settings and rejects banned/pending callers. Reads retain the
  existing tolerant defaults; write errors remain visible. Profile-change
  cooldown timestamps are still client-managed, not server-enforced cooldowns.
- Shared, native-free media URL mapping now resolves R2 avatar keys in both
  public profiles and auth snapshots while preserving external provider URLs.
  Collection hydration now uses the server review aggregates, retains saved
  ordering, and removes unavailable restaurants. Membership writes accept the
  composite-array response format. Empty collections avoid unnecessary queries.
- Verification: all 120 staged app-service/auth tests pass across 15 suites;
  TypeScript and changed-file lint pass. Rollback-only live tests passed for
  reply creation/editing, duplicate/forged-parent/retarget denial, hidden/inactive
  read privacy, ownership transfer, former-author and admin deletion, unique
  view counts, owner/admin analytics, preferences preservation/validation,
  banned/pending callers, and cascading cleanup. The final audit confirmed five
  installed RPCs, enabled RLS, revoked direct preferences/viewer access, and zero
  temporary accounts, restaurants, reviews, replies or view records remaining.
  No device-level interaction or real user workflow was tested.
- No UI/design changed. React Native guidance kept the staged services compatible
  with existing screen-facing field names and kept profile URL logic independent
  of native/storage initialization. Appwrite is still the active backend.

### Audit findings still blocking a safe cutover

1. Remaining community contracts: migrations 19/20 below cover core posts,
   comments/likes, member review feeds, liked-content pages, follow lists and
   profile statistics. Audit remaining saved/blocked/collection reads for API
   caps, and remaining public review reads separately. The global public review
   policy and restaurant review/rating RPCs intentionally remain unchanged;
   member-feed privacy is enforced by the new RPCs, not globally on reviews.
2. Notifications: migration 19 finishes inbox cursors and database unread counts/
   blocked-actor filtering. Provider wiring, account switching, device registration,
   real delivery and Expo receipt handling still need verification.
3. Account deletion: the live Supabase foreign keys currently cascade authored
   reviews, review comments, posts and post comments when a profile is deleted.
   The Appwrite deletion function anonymizes reviews/comments and retains them.
   A trusted, retry-safe deletion flow must preserve that behavior and cover the
   full graph, ownership release, private rows, R2 references, sessions and auth
   deletion. A naive auth/profile delete is NOT a compatible replacement.
4. Remote app gates and paid listing workflows: port `remoteConfig.ts` and audit
   RevenueCat/webhook handling. The deployed payment route still uses Appwrite;
   do not enable it against new Supabase restaurant IDs without migrating it.
5. Original schema baseline, unattended media retries, remaining server-side
   permissions/validation, and physical-device regression tests remain required
   before changing imports/providers or making a Supabase preview build.

Database references: [function permissions](https://supabase.com/docs/guides/database/functions)
and [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Core community and inbox contracts (2026-10-11)

- Migration 19 was applied to the Supabase test project with explicit approval.
  Direct client post/comment/like writes are revoked at table and column level.
  The new functions derive `auth.uid()` and content parents, reject banned/
  pending callers and unavailable/blocked targets, validate text length/basic
  URL/email rules, and restrict post images to four caller-owned R2 keys. The
  existing client link filter additionally catches common obfuscation; neither
  filter is a complete spam classifier. Media guards/cleanup triggers remain on
  posts. Unlike and author deletion remain possible after a block/hidden change.
- Community reads are signed-in only, matching the Appwrite per-document read
  permissions. Restrictive policies filter unfinished/banned authors and mutual
  blocks, including direct post/comment/like hydration, not just the feed UI.
  Review-comment reads also check non-hidden reviews and active/owner/admin
  restaurant availability. Admin moderation continues through its existing
  trusted functions; ordinary admins cannot browse blocked content through the
  normal community read policy. Public reviews/restaurant aggregates are unchanged.
- `supabasePosts.ts` now preserves `Post`/`PostPage` contracts, create/delete/
  detail reads, latest/following feeds and user post pages. Following pages query
  actual relationships in SQL without sending a capped client ID list. Latest/
  following post failures retain the old tolerant behavior. Detail reads return
  null on missing/offline content; writes and user pages surface errors.
- `supabaseSocial.ts` maps review/post comments to the existing camel-case
  fields and derives review restaurant IDs in SQL. Comment threads use ascending
  `(created_at,id)` cursors; posts use descending creation time plus ascending ID.
  JSON pages include one lookahead row and exact visible totals, bounded at 250.
  Batched liked-ID reads deduplicate/chunk at 100. Post like/comment counts are
  full database aggregates, not capped downloads. The existing review counter
  triggers still maintain review counts, and database social triggers alone
  create notifications; the mobile adapters send no extra notification request.
- Inbox filtering now occurs through RLS before pages and unread counts are
  computed. The current recipient is derived server-side; users cannot query
  someone else's inbox through the RPC. Inbox pages have a 100-row client/server
  bound and tied-date cursors. Unread counts include all visible unread rows.
  Mark-read writes remain limited to `is_read`, scoped to the recipient. Cross-
  recipient client dedupe is intentionally not ported: the database trigger
  performs trusted, serialized deduplication without exposing inboxes.
- Verification: all 141 staged app-service/auth tests pass in 16 suites;
  TypeScript and changed-file lint pass. Live rollback-only fixtures used 1,006
  accounts, 254 feed posts, and over 1,000 post comments, likes and inbox rows.
  Tests passed for full aggregates, keyset ties/lookahead/bounds, actual following,
  forged parents/foreign image denial, link/length validation, duplicate likes,
  review counters, mutual-block read/write restrictions, consistent inbox badge/
  totals, banned/pending writes, author/admin deletion and cascades. Fixtures and
  queued push work were rolled back; no real device push or R2 upload/delete ran.
  A final read-only audit confirmed RLS on all six community/inbox tables,
  denied anonymous community reads/direct client writes, and zero remaining
  community fixtures.
- React Native guidance kept list payloads/cursors compatible with existing
  screen contracts and avoided new native dependencies. No screen, style or
  provider imports changed; Appwrite remains active. This is core community/
  inbox preparation, not complete community/profile parity or backend activation.

### Review feeds, liked-content tabs and profile/follow statistics (2026-10-11)

- Migration `20261011000020_profile_feeds.sql` was approved and applied to the
  test project. Latest, following and user review pages derive visibility from
  the active caller, actual follows, non-hidden content, completed/non-banned
  authors, mutual blocks and active/owner/admin restaurant access. Following
  feeds use the complete database graph, not a capped caller-supplied ID array.
- New staged services preserve camel-case `Review`, `ReviewPage`, `User`,
  `LikedReviewsPage`, `LikedPostsPage` and `FollowListPage` contracts. Review feeds
  and liked-review failures throw; liked posts, single detail reads, follower
  lists and decorative statistics preserve their tolerant fallback behavior.
  Own-restaurant review reads include the caller's hidden review to keep edit/
  duplicate-review flows intact; ordinary review detail reads do not expose it.
- Like pages sort by like time, not content age, return `likedAt` maps for the
  combined Likes tab, and filter unavailable content before paging/counting.
  Follows and likes use composite keys: opaque cursors are the other user/content
  ID within the queried relationship, ordered by descending timestamp then ID.
  Each RPC returns up to 250 + one lookahead; the shared collector can assemble
  larger requests (up to 2,000). A removed/now-invisible anchor yields an empty
  continuation, consistent with the earlier community paging contract.
- Profile review count, one-decimal average and distinct nonblank parish count
  are full SQL aggregates of member-visible reviews, with no 1,000-row scan cap.
  Follow counts now use the existing screen names `followerCount` and
  `followingCount`, with the same member visibility as follower/following pages.
  Suggested users rank by full visible follower counts rather than the latest
  500 edges; self, banned, pending and mutually blocked suggestions are excluded.
- Direct follow writes are revoked, including column write grants. Active
  members call `set_member_follow`; identity is derived server-side, self/
  unavailable follows are denied and repeated follows are idempotent. Unfollow
  remains available after a block. Authenticated follow SELECT is restrictive;
  anonymous follow reads and all new anonymous RPC access are denied. The
  existing database follow notification trigger remains the sole producer.
- Public restaurant ratings and global review policies are unchanged. These
  member-only services do not claim to hide reviews from the existing public
  restaurant endpoints. Saved restaurants, block management and private profile
  permissions were not changed by this phase. No account roles were assigned.
- React Native guidance kept all screen-facing payloads and error contracts
  compatible. No screen, style, provider import or native dependency changed;
  Appwrite remains active. This prepares the Supabase services, not the cutover.
- Verification: 157 staged app/auth tests passed across 17 suites, including
  16 new profile-feed adapter tests. TypeScript and changed-file lint passed.
  Live rollback tests used 1,006 fixture accounts, 1,006 restaurants/reviews,
  251 posts and more than 2,000 follow edges. They passed full counts/parishes,
  tied cursors/lookahead/bounds, complete following graph, like-recency over
  content age, private profile projection, hidden/banned/pending/inactive reads,
  mutual blocks, self/unavailable follow denial, idempotent follows and one
  database notification, own hidden-review editing access, and unchanged public
  ratings. Final read-only audit verified all nine RPC permissions, follow RLS/
  revoked client writes, and zero test fixtures remaining. No real push, image
  upload/delete or physical-device flow was run.

### Account deletion (2026-10-12 — approved/applied/deployed)

- Migration `20261012000021_account_deletion.sql`, `delete-account` and
  `retry-account-deletion` Edge Functions were approved and applied/deployed to
  test project `ezhnntopskzlhllljbdv`. `supabaseAccountDeletion.ts` remains staged
  locally. Settings still calls Appwrite; no UI, provider imports or
  native dependencies changed. React Native guidance preserved the existing
  summary, error and "Deleted user" contracts rather than changing screens.
- The live metadata audit confirmed four author foreign keys used CASCADE,
  which would otherwise erase reviews/ratings and community threads. The applied
  migration uses nullable SET NULL authors and a server-owned retention flag.
  Reviews, comments, posts, post comments and referenced photos remain;
  banned/pending-author community content does not become visible by deleting
  its author. Existing hidden reviews and public rating rules remain intact.
- Self-deletion accepts only `{}` and derives its target from a network-verified
  Auth user. The private service-only preparation function atomically removes
  the public profile and its private/owner data, clears restaurant ownership,
  removes both relationship directions and notification copies (including actor
  names in other inboxes), and records a retry job. Auth is hard-deleted LAST.
  Completion checks the Auth row really is absent; 404 alone is not success.
- A missing profile immediately denies active-member functions even before the
  old JWT expires. The app pins the original JWT without copying/refreshing its
  refresh token. It never submits a user ID or privileged key. On confirmed
  deletion it signs out locally only if that same account is still current.
  Failures surface; local cleanup failure does not misreport server deletion.
- Retry maintenance accepts the project's existing default secret key and
  processes at most 20 DB-recorded prepared jobs, never caller-supplied targets.
  It is deployed but NOT scheduled. Jobs retain only UUID, counts and status,
  not names/emails/tokens/content. Lost-response deletion can be ambiguous to the
  mobile caller after Auth disappears; support/maintenance can verify the job.
- Removed avatars enter the existing private media-cleanup queue. Media still
  referenced by retained reviews/posts/listings is protected. Physical R2 cleanup
  and sweeping uploads that never acquired a DB reference are NOT implemented by
  this phase; do not promise immediate or exhaustive object deletion.
- SQL preservation tests and the final audit passed live. They cover 1,001
  comments, full counters, private cascades, preserved ratings/
  photos, banned-author visibility, old-JWT denial and idempotent Auth-last retries
  using three rollback-only synthetic users. The audit confirmed the private
  job table's RLS, service-only deletion RPCs, four retention foreign keys,
  revoked content TRUNCATE grants and zero remaining fixtures. A menu fixture
  was corrected to the schema's array format before the successful run. No
  real account, device push or physical R2 object was deleted.
- The remaining read-only permissions audit found broad dashboard-default table
  grants (including TRUNCATE) on reviews, saves, blocks and collections. Review
  grants are tightened in migration 21. Saves/block/collection hardening and
  unfinished-account review/push registration checks remain follow-up work.
  Their current owner/participant RLS does not mean all grant/write paths are
  ready for cutover. Review public reads also intentionally lack global member
  block filtering. Only the review grants were changed live in this phase;
  the remaining findings have NOT been changed live.
- Dashboard deployment packages contain `index.ts` and a per-function copy of
  the exact tested `_shared/accountDeletion.ts` helper, imported as
  `./accountDeletion.ts` (the repo/CLI uses `../_shared/accountDeletion.ts`). Full
  editor contents were compared before deployment. Self-deletion keeps the
  platform JWT check ON plus `withSupabase` user verification and network
  `getUser`; retry keeps that JWT gate OFF and uses `withSupabase` secret auth.
  Both settings were verified in the dashboard. No new credential was created,
  read or printed. The CLI has no login; deployments used the logged-in UI.
- Live endpoint smoke checks rejected missing credentials on both functions,
  a forged JWT on each, and an invalid publishable key on retry (all HTTP 401).
  No real user JWT or server secret was used for those checks. This verifies
  denial/startup paths, not a successful mobile Auth deletion or secret-powered
  retry. Those end-to-end flows remain part of controlled device testing.
- Verification: all 169 staged service/auth tests across 18 suites (including 12
  new deletion adapter cases) and five server helper tests pass;
  app TypeScript, changed-file lint and both Deno entry-point checks pass. The
  full Jest run passed 219 tests in 26 suites but its unrelated reviewerBadges
  suite could not load the React Native/Flow icon dependency in the existing
  node-only test setup. That UI/test configuration was left unchanged.

### Saved restaurants, blocks and collections (2026-10-12 — approved/applied/tested)

- Migration `20261012000022_saved_block_collection_permissions.sql` was approved
  and applied to test project `ezhnntopskzlhllljbdv` through the logged-in dashboard.
  The metadata-only dashboard audit confirmed broad table
  grants, owner/participant RLS, composite save/block keys, the collection title
  constraint and its timestamp trigger before the approved permission changes.
  No real account, role assignment or application data was changed.
- All three tables revoke client writes, TRUNCATE and column write/reference
  grants. Authenticated SELECT remains under restrictive active-member RLS.
  Saves stay owner-only; blocks stay participant-only. Collections are
  signed-in-only, with private owner/admin reads and public reads excluding
  banned, pending and mutually blocked owners. Admin read access is preserved;
  collection write RPCs are owner-only, matching the staged adapter's existing
  owner filter. No real role/admin assignment was made.
- Caller-checked, empty-search-path functions derive identity on the server.
  Saves serialize each member/restaurant's buckets, atomically excluding
  visited/want-to-go while keeping favorite independent. Repeated writes are
  idempotent; removal remains allowed for inactive restaurants. Blocks allow
  blocking back and blocking banned/pending profiles; unblocking removes only
  the caller's direction. Self-blocking keeps the existing error message.
- Collection metadata accepts only title/description/visibility and validates
  their types plus the existing 2–100 character title constraint. Membership
  remains ordered and unique under a row lock, allows only active additions,
  permits inactive removals and repairs the cover after removal. Owner IDs,
  timestamps and membership cannot be forged through metadata patches.
- Staged Supabase adapters now call these functions with no supplied caller ID.
  Thirteen new tests cover payloads, rejected/malformed writes and unchanged
  public-collection rating hydration. All 182 service/auth tests in 19 suites,
  TypeScript and changed-file lint pass. All 182 tests were rerun after approval.
  Live SQL rollback tests passed with five synthetic accounts, two restaurants
  and four collections: save exclusion in both directions, independent favorites,
  idempotency, inactive removals, metadata types/ownership, membership/cover,
  block-back/directional removal, private/public/blocked/banned/pending reads,
  admin read preservation with owner-only writes, direct-write denial, and denial
  of all five write RPCs for banned, unfinished and stale/deleted callers.
  The fixture's admin role CASE expression needed an explicit `public.app_role`
  cast; that fixture-only issue was corrected before the successful rollback run.
  A temporary query-status diagnostic found no blocked synthetic test query and
  its temporary browser tab was closed. The final read-only audit passed RLS,
  table/column grants, function permissions/empty search paths and zero fixtures.
  No device flow or
  concurrency stress test has run, and these listing reads remain API-capped;
  this phase does not claim full saved/block/collection paging parity.
- React Native guidance kept screen contracts and native dependencies stable.
  No screen, styling, provider import or backend cutover changed. Appwrite
  remains active. No Worker/Edge Function deployment is needed for this phase.
- Permission design follows [Supabase database-function guidance](https://supabase.com/docs/guides/database/functions)
  and [PostgreSQL's RLS limitations](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

### Account guards and member paging (2026-10-12 — applied and tested)

- Migration `20261012000023_account_guards_member_paging.sql` was approved and
  applied to test project `ezhnntopskzlhllljbdv`. The live editor confirmed success.
  A preceding metadata-only audit found broad anonymous/authenticated token
  TRUNCATE/reference/trigger grants; the migration removes those grants.
- Review create/edit and push registration now use the existing complete,
  non-banned account guard. Review deletion adds the same active
  account requirement on top of existing own/admin permissions. Public review
  reads and rating aggregates intentionally remain unchanged; this is not global
  mutual-block filtering of anonymous/public restaurant reviews.
- Review writes accept only restaurant/rating/comment/images (restaurant only on
  create), retain existing text/length/rating rules, protect author/counter/
  moderation/retention fields, and accept new images only in the caller's review
  upload namespace. Previously referenced images may remain during edits. Own
  hidden/inactive-listing reviews can still be edited without unhiding them.
- Push registration validates null/type/length input, keeps existing advisory
  locking and device-token reassignment, and uses an empty search path. Broad
  token grants are revoked; authenticated owner SELECT/DELETE remains, including
  logout cleanup for banned/unfinished accounts. Synthetic token registration,
  reassignment and banned-user cleanup statements ran only inside the rolled-back
  database tests. No real push was sent or physical-device registration attempted.
- Five new private read RPCs add per-bucket save pages, full saved counts,
  deduplicated two-way hidden-user IDs, own blocked-profile management pages and
  filtered collection pages. SQL pages return a full count and up to 250 rows
  plus lookahead. Save/block ties use descending relationship time plus UUID;
  collections use updated time (matching Appwrite's recent-update ordering).
  Hidden IDs use UUID order and include banned/pending/incoming-only blocks.
- Existing array/Set adapters now collect every bounded page with no 1,000/2,000
  total-result cutoff and reject duplicate rows/repeated cursors rather than
  returning a partial hidden-user filter. New page exports provide continuation
  for future screen wiring. Saved counts include all saved rows, matching the
  old aggregate contract; unavailable restaurant hydration may produce fewer
  displayed items than save rows, but cursors remain on the saved relationship.
  Block management returns only existing public-profile fields, never private
  preferences/email/roles. Large arrays still have device-memory costs; use the
  new paged contracts when wiring the Supabase backend into screens.
- All 195 staged service/auth tests in 20 suites, TypeScript and changed-file lint
  pass. Thirteen new cases exercise 1,101-row saves/collections, a 2,101-user
  hidden set, order/cursors, malformed/repeated pages, privacy-filter failure,
  full counts and propagated account-guard errors. Live rollback-only SQL tests
  passed with 2,106 synthetic users, 1,101 restaurants and 1,103 collections.
  They checked tied cursors/full counts, hidden-union deduplication and incoming
  blocks, public-only collection filtering and blocked/unavailable owners,
  review field/image ownership protection, hidden/inactive review edits,
  token validation/idempotency/reassignment, inactive-account write/delete
  denial, anonymous denial, and unchanged public restaurant rating counts.
  The final read-only audit independently verified RPC grants/empty search paths,
  token table/column permissions, the restrictive review DELETE policy and zero
  remaining fixture users/profiles/restaurants/collections/reviews. Owner token
  SELECT and DELETE grants are checked separately, not as an any-privilege list.
- React Native guidance kept service payloads and native dependencies stable.
  No UI/styles, screen/provider imports, Worker/Edge Function deployments or
  Appwrite cutover changed. This remains staged migration work, not device proof.

### Remote configuration and payment audit (2026-10-12 — applied and tested)

- A live read-only metadata audit confirmed `app_control` already has the
  maintenance/message/version/store-URL columns. It also found broad client
  write/TRUNCATE/reference/trigger grants on configuration tables. No permission
  or configuration value was changed by that audit.
- Migration `20261012000024_remote_configuration.sql` was approved and applied
  to test project `ezhnntopskzlhllljbdv`; the live editor confirmed success.
  It removes broad table/column mutations while preserving existing public reads
  and spotlight configuration. An explicit public read RPC exposes only gate
  fields and display catalogs, never account data or credentials. Two empty-path
  admin RPCs require a completed, non-banned admin and validate partial patches.
- The migration adds JSONB feature/listing display catalogs with null/empty fallback
  semantics, bounded durations/prices, duplicate checks and unambiguous product
  kinds. Prices remain informational; this migration does not fulfill purchases.
- Staged gate adapters preserve maintenance priority, required/optional update
  checks and default text. Configuration reads abort after eight seconds and
  fail open on failure. Unsafe store URLs become empty rather than executable
  links. The active `AppGateProvider` still imports Appwrite; no UI was changed.
- Display-plan adapters preserve current defaults and payloads, reject malformed
  catalogs and provide admin-only patch contracts without importing live Appwrite
  services at runtime. Native dependencies and lazy purchase SDK loading remain
  unchanged, following the React Native guidance.
- All 217 staged service/auth tests in 21 suites pass, including 22 new cases for
  gate precedence, platform URLs, timeout/abort cleanup, pre-auth reads, defaults,
  malformed plans and admin error propagation. TypeScript and changed-file lint
  pass. Live rollback-only SQL tests passed for public reads, partial admin
  configuration/catalog edits, null/empty resets, invalid fields/messages/
  versions/URLs/durations, duplicate/ambiguous products, direct-write/TRUNCATE
  denial and member/banned/pending/stale-account admin denial. Only four
  synthetic accounts were used, with notifications disabled; their temporary
  admin role and all configuration edits rolled back. The final read-only audit
  passed RLS, table/column grants, RPC permissions/empty search paths and zero
  remaining fixture accounts/profiles. No real admin role was assigned.
- Payment routing still uses the Appwrite webhook. Live Supabase metadata has no
  purchase ledger. See [payment cutover prerequisites](PAYMENT_CUTOVER.md) for
  explicit backend routing, verified identity and transaction binding, atomic
  renewal/transaction deduplication, failure handling and sandbox-test requirements.
  No Worker/Edge deployment, purchase, webhook routing or credential change ran.

### Disabled purchase foundation (2026-10-12 — applied and tested)

- Migration `20261012000025_purchase_foundation.sql` was applied to test project
  `ezhnntopskzlhllljbdv` with user approval.
  It adds private routing settings (disabled, sandbox-only, no project/apps),
  owner-checked idempotent restaurant/product intents, status reads and a
  service-role-only fulfillment contract. Clients cannot write/read the ledger,
  alter routing settings or call the privileged grant function.
- Intent creation snapshots validated server plan days/kind. The trusted grant
  checks route/app/store/environment, exact buyer/product, verified purchase
  time, completed non-banned buyer and current active restaurant ownership.
  The ledger and independent feature/listing windows update in one transaction;
  unique RevenueCat/store purchase constraints prevent duplicate attribution.
  Restaurant locks serialize extensions; no concurrency stress test has run.
- A pure, network-free RevenueCat v2 verification helper passes 21 Deno tests.
  Ten new intent/status adapter cases pass; all 227 staged service/auth tests in
  22 suites pass, with TypeScript and changed-file lint clean. No native purchase
  SDK call, live RevenueCat request, credential access or real purchase occurred.
- Rollback-only fake-proof SQL tests passed intent idempotency, immutable terms,
  buyer/ownership checks, private status reads, transaction deduplication, retries,
  renewal stacking and atomic independent feature/listing windows. The read-only
  audit passed private grants/RLS, service-only fulfillment, disabled sandbox
  settings with no configured project/apps, and zero remaining synthetic fixtures.
  These are contract tests, not real purchase proof or concurrency stress tests.
  No UI/provider/screen, Worker route, Edge endpoint, deployment or Appwrite
  cutover changed. React Native guidance kept native SDK loading untouched.
- See [payment cutover prerequisites](PAYMENT_CUTOVER.md) for remaining trusted
  network verification, identity/transaction correlation, submission retry,
  sandbox device testing and production refund/retention decisions.

### Trusted purchase endpoint and durable checkout (2026-10-12 — local only)

- Prepared `verify-purchase`, with platform JWT validation, network-checked Auth,
  active caller-scoped intent checks and buyer-filtered private queries. Only two
  request identifiers are accepted; purchase/product proof is fetched from the
  fixed RevenueCat v2 origin, never accepted from the client. JSON requests are
  capped at 2 KiB and upstream JSON at 128 KiB, with 8-second read/fetch bounds,
  no redirect following, no-store responses and sanitized error codes. Missing
  purchases remain pending; network failures preserve retry semantics.
- Server and client enable switches are absent/disabled by default; existing
  database payment settings remain disabled. No function deployment, secret
  configuration, RevenueCat call, webhook change or real purchase was performed.
- Staged checkout saves a per-account pre-charge journal, then the exact store
  result before verification. Retries submit/read status only, never buy again.
  Uncertain store outcomes/crash gaps require explicit transaction recovery.
  Storage failure before purchase prevents charging; after payment the receipt
  is retained in memory and the durable marker prevents rebuying after restart.
  Identity changes and checkout are serialized in the singleton, with verified
  UUID identities and pinned submission JWTs. No anonymous logout, restaurant
  subscriber attribute, screen/provider import or active Appwrite changes.
- Migration `20261012000026_purchase_verification_budget.sql` and rollback/audit
  SQL tests are prepared, NOT applied/run. They add a private service-only fixed
  window budget (30 project / 5 buyer attempts per minute); owner counters cascade
  on profile deletion. Missing/exhausted budget fails closed in the endpoint.
- All 249 staged app-service/auth tests in 24 suites and 47 Deno purchase tests
  pass. The endpoint type-checks; no physical-device transaction correlation,
  live network verification, SQL budget test or concurrency stress test has run.
  React Native guidance kept the SDK lazy and existing native dependencies intact.

### Free-launch decision (2026-10-13)

- User confirmed no subscriptions or payment-related launch activity. Payment
  migration 26, verifier deployment, secret setup, checkout integration and store
  purchase testing are DEFERRED, not launch prerequisites. Migration 25 remains
  disabled; no payment credentials/settings/deployment were changed.
- Existing `PAID_FEATURES_ENABLED=false` already hides paid routes/entry points,
  renewal status and Premium upsells and skips listing-expiry filtering. No UI or
  design changes were needed. Free ownership claims and manual admin spotlight
  remain available. Supabase restaurant paging also uses this flag.
- Added the same master flag to both legacy RevenueCat and staged Supabase
  checkout service gates. Keys/EAS environment flags alone cannot enable native
  checkout in the free-launch build. Regression tests cover configured keys and
  an enabled Supabase environment flag without loading/charging the native SDK.
- All 251 app-service/auth tests in 25 suites pass, with TypeScript and changed
  file lint clean. No native store, preview build or external payment service ran.

### Session/device race hardening (2026-10-13 — staged only)

- Added request-local, network-verified session pinning. It does not install,
  refresh or revoke another client session, persist credentials or log tokens.
- Device registration and cleanup serialize within this app instance. Each
  operation captures its account/token before queueing; writes use that exact
  JWT on an isolated client, not whatever shared login exists later. Android
  channel setup still precedes permissions. Owner/device cleanup filters protect
  new-account associations; API requests have 5-second registration/1.5-second
  deletion bounds. Local cleanup identity is saved before server registration,
  so storage failures prevent writes and uncertain requests retain retry identity.
- Delayed logout cannot sign out a replacement account or token. Cleanup is still
  best effort with a two-second deadline; a token refresh during that interval
  safely asks for another logout attempt. Login checks its returned Auth identity;
  banned-login cleanup cannot sign out a later account. Snapshot loading rejects
  mismatched profile IDs and failed final session checks. Auth event transitions
  clear a previously published account/role before asynchronously loading another.
- Tests cover pinned credentials, revoked sessions, account/token switching,
  native permission/storage failures, registration ordering, owner-only cleanup,
  login races, stale snapshots and cleanup deadlines. No real push, native device
  permission prompt, provider wiring, UI edit, deployment or cutover occurred.
  React Native guidance kept native work explicitly invoked and lifecycle cleanup
  intact. Provider retry/cache isolation, real delivery, Expo receipt handling
  and device regression are still pending; this is not end-to-end push proof.
- All 269 app-service/auth tests in 26 suites pass; TypeScript and changed-file
  lint pass. The running providers still use Appwrite.
- Official references: [Supabase auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
  [local logout](https://supabase.com/docs/reference/javascript/auth-signout),
  [Expo device push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

### Live schema audit/recovery candidate (2026-10-13 — read only)

- Captured a 1,470-row schema-only CSV from PostgreSQL 17.6, plus the read-only
  export query and checksum/byte-count manifest. It includes 33 RLS-enabled tables,
  three enums, 102 non-extension functions, one public-profile view, 158
  constraints, 28 independent indexes, 58 policies and 26 safe triggers.
  Object counts/UTF-8 DDL bytes matched the live query; local SHA-256 matches the
  manifest. Capture order was corrected for four view-row-returning functions.
- No Auth/application rows, R2 files, credentials, Vault values, webhook headers
  or cron commands were exported. The credential-pattern guard blocked nothing.
  Managed extensions/schemas, seeds/default ACLs, owner changes and environment
  configuration remain separate. There were no public sequences, identity columns,
  domains, partitions, custom collations or non-default trigger modes.
- This is NOT a full data backup, tested restore or complete security certification.
  Local psql/Docker/Supabase CLI executables were unavailable; a separately approved
  disposable-project restore and contract tests remain required before cutover.
- Dashboard still lists only the three non-payment Edge Functions. Payments are
  disabled; payment budget 26 and verifier deployment remain deferred. Safe
  metadata confirmed the push webhook and active minute-based retry job without
  reading their credential arguments/command bodies.
- The audit found ordinary roles retain TRUNCATE/TRIGGER/REFERENCES/MAINTAIN on
  restaurants and notifications, plus anonymous inbox DELETE. Migration
  `20261013000027_nonpayment_privilege_cleanup.sql` and its rollback/read-only
  audits were prepared but not applied/run during the read-only capture; the
  approved application/results are recorded below. Legitimate owner mark-read/delete, review
  deletion, logout token cleanup, RPC/admin/server access and RLS must stay intact.
  See `SCHEMA_AUDIT_20261013.md` and `baseline/README.md` for exact scope.
- No live DDL/grants, real data deletion, admin assignment, push, deployment,
  UI/design, Auth provider or active Appwrite backend changed during this audit.

### Non-payment permission cleanup (2026-10-13 — applied/tested)

- Migration 27 was applied with user approval to `ezhnntopskzlhllljbdv`. It removes
  ordinary-role TRUNCATE/TRIGGER/REFERENCES/MAINTAIN and column REFERENCES from
  existing public tables, anonymous notifications DELETE, and corresponding
  `postgres` public-table default grants. Managed `supabase_admin` defaults,
  RLS/policies, reads, normal owner actions and RPC/admin/server grants are intact.
- Rollback tests passed public-table defaults, owner-only inbox reading, mark-read
  and deletion, body-update denial, other-owner deletion denial and anonymous
  deletion denial. Only two synthetic accounts/notifications were used; all
  fixtures/queued requests rolled back. No real table was truncated/data deleted.
- Final read-only audit passed all public tables/column grants/RLS, legitimate
  review/token DELETE and admin RPC EXECUTE grants, trusted-role grants, disabled
  payments and zero remaining test fixtures. This is grant/contract verification,
  not proof of end-to-end device or every admin action.
- All 269 app-service/auth tests in 26 suites still pass; diff whitespace check
  is clean. No real admin assignment, push, UI change, deployment, payment activity
  or Appwrite cutover occurred. The captured baseline CSV remains a checksum-
  verified PRE-27 snapshot; restore it only with the post-snapshot correction.

### Isolated local schema restore (2026-10-13 — passed)

- Added a reproducible in-memory PostgreSQL restore harness in
  `baseline/test_restore.mjs`, with PGlite 0.3.14/PostgreSQL 17.5 (live is 17.6).
  A preliminary PostgreSQL 18.6 run passed too. No billable hosted project,
  app dependency, credential, UI, native operation or live database changed.
- The harness verifies the immutable CSV checksum/count/byte manifest, restores
  all 1,470 statements in dependency order, validates all 102 function definitions
  with body checks enabled, applies only post-snapshot permission migration 27,
  seeds safe config defaults and verifies the object graph. It does not replay
  historical 1-25 or apply deferred payment migration 26.
- All 19 selected non-payment SQL suites/audits passed, covering profile/auth
  completion, moderation/claims, restaurant admin, pagination/media cleanup,
  owner contracts, community/profile feeds, account deletion, saves/blocks/
  collections, account guards and remote config. No synthetic accounts remained;
  payments stayed disabled. Exact results are in `baseline/restore-test-20261013.json`.
- This uses minimal managed Auth doubles, not a hosted Supabase Auth server.
  It has no HTTP/env/write permission, webhook/cron credentials or network services.
  SMTP/OAuth/JWT/session APIs, R2/Edge/push delivery, hosted restore, concurrent
  transactions and physical devices remain unverified. This is stronger local
  schema/contract validation, not a complete migration or production certification.

### Test-only integration foundation (2026-10-13 — staged)

- Added a fail-closed future app selector, explicitly opted-in development/
  preview gateway for 28 lazy non-payment service domains, and compile-time
  original-name ports for review/user/admin and restaurant-read contracts.
  Production/unknown build labels and privileged key types are rejected.
- Added pure account/backend/project cache scope controls: synchronous clearing,
  serialized cleanup, abort/generation checks and guarded result publication.
  Regression tests cover account switching, A→B→A, backend changes, logout,
  cleanup failure/retry and disposal. Source-import auditing excludes erased
  types and verifies no Appwrite/payment SDK value edge from the gateway/ports.
- Nothing is connected to live screens/providers or EAS environments yet; the
  app remains Appwrite. Ports do not yet cover every legacy surface/error class,
  and cache hydration/throttled persistence still require coordinated integration.
  No UI/design, remote mutation, deployment, real login/push or payment occurred.
  React Native guidance kept SDK/native initialization explicit and highlighted
  lifecycle/cache boundaries. See `BACKEND_INTEGRATION.md` for remaining work.
- All 325 staged app-service/auth tests in 31 suites pass (56 new foundation/
  contract/isolation tests). TypeScript, changed-file lint and diff whitespace
  checks pass. No preview/release bundle or physical-device test ran.

### Original-name screen-service contracts (2026-10-13 — staged)

- Added a lazy typed registry for 28 non-payment screen-service groups backed by
  30 staged module domains, including authentication, storage, saves/badges,
  community, inbox/device tokens, owner/admin/report/config/deletion tools.
  Compile-time legacy function checks cover parameters/results and synchronous
  helpers/flags. No screen-service imports/providers are rerouted yet.
- New save adapter keeps opaque composite string IDs and unavailable listings,
  global newest-save ordering/limits and bounded paging. Verified request-local
  credentials protect saves and badge preferences; replaced-account/token
  responses cannot publish previous-account results. Server-atomic save writes
  preserve visited/want-to-go exclusivity. Badge sync keeps the silent legacy
  baseline and in-app serialization; cross-device dedupe is not claimed.
- Auth email confirmation now has a read-only Auth-proof assertion; device
  registration/cleanup honor captured provider identity. Obsolete client inbox
  dedupe/notification creation and menu-permission seeding are intentionally not
  mapped, since those are server-owned. No payment mutation/checkout is mapped.
- Extracted/re-exported existing compression, profile validation and menu codecs
  without changing settings, messages or behavior. No UI/design file, provider,
  EAS environment, hosted schema, Worker or deployment changed. Native guidance
  preserved existing Expo dependencies/settings and initialization boundaries.
- All 407 targeted service/auth/shared-helper tests in 37 suites pass;
  TypeScript, changed-file lint and whitespace checks pass. Actual preview/native
  SMTP/OAuth/R2/push tests and coordinated runtime cutover are still pending.
  See `BACKEND_INTEGRATION.md` for explicit exclusions and the next integration.

### Facade/provider wiring (2026-10-13 — connected but activation blocked)

- Existing imports now use 28 lazy service facades. Appwrite bodies remain in
  `src/services/legacy`, with SDK-free shared errors and explicit type exports.
  Appwrite config/SDK initialization is deferred; disabled payment plan readers
  no longer eagerly initialize it. No Supabase fallback to Appwrite is allowed.
- Added guarded Supabase AuthContext/query-provider wiring with bounded restore,
  verified snapshot subscription, stale event/refresh/disposal protection,
  banned-account sanitization, serialized auth actions and per-transition cache/
  child-state teardown. Test caching is memory-only; the Appwrite disk cache and
  its options remain unchanged. Last-OAuth display metadata is project-isolated.
- EAS profiles now include build classification only, not Supabase activation
  flags or credentials. Readiness remains false, Appwrite remains selected, no
  payment/native store activity or hosted mutation/deployment occurred. Layout
  changes are provider wrappers/cache-hook logic only; no styling/assets/design
  changed. The native skill guided lazy SDK and lifecycle/cache isolation.
- All 448 targeted tests in 40 suites, TypeScript/lint/whitespace checks pass.
  Local Android Metro/Hermes export passes (4,546 modules/106 existing assets),
  not an APK/device test. Remaining write races and mounted-provider/native
  behavior need validation before test activation. Durable Supabase offline
  persistence is still pending; this path deliberately hydrates no private disk
  cache. See `BACKEND_INTEGRATION.md` for scope and remaining tests.

Next: audit credential-sensitive write races and mounted-provider behavior,
then enable an explicitly separate Supabase test preview for device checks.
Payment code stays
unwired/dormant until a separate explicit future decision; no store-approval
guarantee is implied by removing monetization from launch.
Baseline export, cleanup automation and physical-device regression testing
remain before cutover.
