# Supabase Android preview

Update (2026-10-17): the phone checklist below passed according to the user.
Normal `development`, `preview` and `production` profiles now use Supabase + R2
with test mode disabled. For the next regular Android preview use
`npx eas-cli build --platform android --profile preview`. The older
`preview-supabase` command below remains available for internal regression tests.
No new build/store submission is started by the configuration change.

Build the opt-in test APK from the project root:

```powershell
npx eas-cli build --platform android --profile preview-supabase
```

This starts an EAS build and can consume build quota. It has not been run by the
agent. Normal `--profile preview` now uses Supabase too. This profile supplies
its own explicit backend/test flags and public service settings. It is an
internal APK, not a development client or store submission.

Only a public publishable/anon key is in the profile. Never add service-role,
SMTP, Google client-secret, R2 secret or Edge Function secrets. Public client
settings are compiled into the app; database/Worker authorization remains the
security boundary. Production builds use normal mode and reject test-mode flags.

The APK uses the existing Android package/signing identity and can replace your
installed preview. It is not a separately named side-by-side app. Existing
Appwrite accounts/data are not migrated; create a fresh Supabase test account.
Supabase query caches are memory-only and do not hydrate the Appwrite disk cache.
Do not expect durable offline restaurant/feed browsing yet.

## Phone checks, in order

1. Open the installed APK without Metro; force-close and reopen it. Check splash
   completion online, then offline startup and recovery when connectivity returns.
2. Sign up with email, verify the six-digit code, sign out/in, restart, and test
   password reset plus Google sign-in. Apple sign-in is not configured.
3. Save profile/avatar changes. Add a restaurant and check its admin approval
   using a separately authorized test admin (this stage assigns no admin role).
4. Check restaurant detail, map, reviews, real ratings in public collections,
   saves, blocks, follows and community posts/comments/likes. The map limit stays
   2,000; an empty test database naturally has no pins.
5. Upload and reopen photos through R2; test cancelling an upload or switching
   accounts mid-action. No old account's results should appear in the new one.
6. Test inbox/unread counts and push on a real Android device: foreground,
   background, terminated/cold-start taps, logout and account switching.
7. Test account deletion only on a disposable account you choose. Confirm
   anonymized public content and removal of private/owner data.
8. Confirm no subscription, purchase, paid promotion or renewal entry points.

Report the first failure with the screen, action, device/Android version and exact
error. Do not post OTPs, passwords, session tokens or server credentials.

Normal Supabase preview build command:

```powershell
npx eas-cli build --platform android --profile preview
```
