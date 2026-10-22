# Separate signup welcomes and password-change alerts

Status (2026-10-20): both functions deployed and migration 28 applied to
`ezhnntopskzlhllljbdv`; **activated with the user's explicit approval**.
`RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `SEND_EMAIL_HOOK_SECRET` are saved.
Legacy JWT verification is OFF for both functions; the handlers enforce a signed
Auth webhook and server-secret API key, respectively. The saved Send Email HTTPS
hook is enabled, and the password-changed security notification remains enabled.
The previous SMTP settings are retained for rollback, but templates/SMTP are not
the active sending path while this hook is enabled.

Welcome processing is enabled, with one active pg_cron job named
`hidden-plate-welcome-email-retries` running every minute. The activation SQL is
saved in `operations/enable_welcome_email_delivery.sql` (not an automatic schema
migration). Unsigned/missing-credential POST probes returned 401 from each
handler. A server-authenticated empty-queue probe returned HTTP 200 with
`{"processed":0,"accepted":0}`. No real email was sent by these probes; signed
Auth delivery, Resend acceptance, and signup/password-change inbox delivery still
require the user's installed-app tests. No app/UI code changed or new APK is needed.

Before activation, the hosted rollback-only SQL suite passed. A staging read
verified welcome delivery disabled, zero welcome jobs, zero remaining synthetic accounts, and
client access to the password-notification classifier denied. Deployed modules
use the same local source, with shared files placed alongside `index.ts` and only
the entrypoint relative imports adjusted for the Dashboard editor layout.

Local verification: 31 new email/hook/processor tests pass (83 shared Edge
Function tests total), both new Edge Function entrypoints type-check, 29 existing
client email/OAuth tests pass, and the isolated schema restore plus migration 28
passes all 21 SQL suites with no synthetic accounts left over. App TypeScript
and whitespace checks pass. These are not hosted delivery tests.

## Behavior

- Email verification remains a six-digit code with a ten-minute expiry. Signup,
  magic-link/OTP, recovery and reauthentication have distinct subjects.
- `send-auth-email` requires a valid Standard Webhooks signature from Supabase
  Auth before any privileged database query or provider call. It suppresses only
  `password_changed_notification` events whose server-owned signup marker still
  exists (the pre-registration password-setup phase). It does not suppress reset
  codes or password-change notices for completed accounts. No client preference
  or editable metadata determines suppression.
- A private database record preserves the signed delivery's suppression decision
  across retries, bound to its user ID and payload hash. No OTP, password, email
  address or message body is persisted in this table. Missing account/DB errors
  fail closed rather than guessing that a security email should be suppressed.
- Successful `finish_auth_signup` removes the pending marker; a trigger then
  queues one welcome per surviving confirmed profile. OTP verification alone,
  failed/rolled-back completion and account-deletion cascades do not send a
  welcome. Both email and Google signup use the same completion boundary.
- `send-welcome-email` accepts only a server secret API key and an empty `{}`
  request. It claims database-recorded jobs; recipient email comes from verified
  Auth data and eligibility is rechecked against the current profile. Clients
  cannot choose recipients, suppress alerts, read jobs or claim deliveries.
- Queue rows have per-attempt leases, five-attempt bounds and a 23-hour retry
  window. Resend idempotency keys are stable per user and provider state is
  retained for 24 hours. `sent` means the provider accepted the message, not proof
  that it reached Inbox. Ambiguous late changes/deletions and provider delivery
  failure cannot be made exactly-once end to end.
- Transport/dispatch failure does not roll back completed registration. Jobs
  remain available for bounded retries. Private email state cascades away with
  the profile. Existing registered users are not backfilled with welcome mail.

## Activation order (do not skip prerequisites)

1. In Supabase **Edge Functions → Secrets**, the user enters:
   - `RESEND_API_KEY`: a valid Resend sending key for the verified sender domain.
   - `AUTH_EMAIL_FROM`: `Hidden Plate <noreply@nutinbutheat.com>` for the current
     test sender (confirm it matches the domain verified in Resend).
   Never put credentials in chat, the mobile app, SQL snippets or Git.
2. Apply migration `20261020000028_welcome_emails.sql` to the intended project.
   It creates service-only state/functions and starts welcome delivery disabled.
   Do not replay historical migrations or deferred payment migration 26.
3. Deploy `send-auth-email` and `send-welcome-email` with the saved project config.
   Both have legacy platform JWT verification off; their actual authentication
   is signed-webhook verification and `withSupabase({ auth: "secret" })`,
   respectively. Neither is a public send-arbitrary-email endpoint.
4. Configure a Supabase **Send Email** HTTPS Auth hook at:
   `https://ezhnntopskzlhllljbdv.supabase.co/functions/v1/send-auth-email`.
   The user generates the signing secret and saves the same value in Edge Function
   secret `SEND_EMAIL_HOOK_SECRET` (`v1,whsec_...` format supported). Do not enable
   the hook until the secret is saved and signed-event handling has been checked.
   Enabling this hook replaces SMTP for ALL Auth emails; retain the working SMTP
   settings for rollback. Keep password-change security notifications enabled.
5. After explicit approval to activate the hook, test a disposable account:
   verification code, signup/password setup without a misleading changed alert,
   completed welcome, password reset code and a genuine password-change alert.
   Confirm Google signup also queues a welcome only after username completion.
6. Enable welcome processing only after deployment/sender verification:

   ```sql
   update public.welcome_email_settings set enabled=true where id=true;
   select public.dispatch_welcome_emails();
   ```

   The dispatcher derives its private endpoint and key inside Postgres from
   existing `push_sender_url` / `push_sender_apikey` Vault entries. It changes
   only the validated `/send-push` path to `/send-welcome-email`; no secret value
   is exported. Missing/malformed setup produces no outbound request.
7. For scheduled bounded retries, separately approve and configure a one-minute
   pg_cron job running `select public.dispatch_welcome_emails();`. No retry job
   is scheduled by migration 28. Until scheduled, new signup dispatches and
   authorized manual dispatches can retry eligible queued jobs.

## Rollback and limitations

Disable the Send Email Auth hook to return to the existing SMTP sender. Set
`welcome_email_settings.enabled=false` to stop new welcome claims/dispatches;
this cannot retract an email already accepted by the provider. Do not delete
jobs to retry: doing so discards the deduplication record.

In-memory PostgreSQL tests simulate managed Auth/Vault/network boundaries and do
not prove hosted hook timing, concurrent connections, sender verification or
actual inbox delivery. Failed/out-of-window jobs need operator review, not an
unbounded automatic resend. The current sender domain is for testing; configure
and verify its replacement plus SPF/DKIM/DMARC before launch.

References: [Supabase Send Email hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook),
[security notification hook events](https://supabase.com/blog/introducing-seven-new-email-templates-for-auth),
[Resend idempotency window](https://resend.com/changelog/idempotency-keys).
