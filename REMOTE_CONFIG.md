# App gating — update checker + maintenance / kill-switch

The app reads a dedicated single-doc Appwrite collection, **`acontrol`**, at
launch (and every time it returns to the foreground) and gates itself
accordingly. Edit that doc in the Appwrite console to **force an update** or
**put the app in maintenance mode without shipping a new build**.

- Service: [`src/services/remoteConfig.ts`](src/services/remoteConfig.ts)
- Gate UI: [`src/components/AppGateProvider.tsx`](src/components/AppGateProvider.tsx)
  (mounted in [`app/_layout.tsx`](app/_layout.tsx))

## 1. Create the `acontrol` collection

In the Appwrite console → Databases → your DB → **Create collection** named
`acontrol`. Add these attributes (all optional):

| Key                  | Type    | Size | Notes |
| -------------------- | ------- | ---- | ----- |
| `maintenance`        | Boolean | —    | Default `false`. |
| `maintenanceMessage` | String  | 500  | |
| `minVersion`         | String  | 20   | e.g. `1.2.0` |
| `latestVersion`      | String  | 20   | e.g. `1.3.0` |
| `updateMessage`      | String  | 500  | |
| `iosUrl`             | String  | 512  | App Store URL |
| `androidUrl`         | String  | 512  | Play Store URL |

Then create a **single document** in it and set the values. (The app reads the
first document in the collection.)

## 2. Wire up the env var

Put the collection ID in `.env.local` (and your EAS build env), then restart
Metro:

```
EXPO_PUBLIC_APPWRITE_ACONTROL_COLLECTION_ID="<the acontrol collection id>"
```

> If this is **blank/unset**, the gate is simply off — the app never gates.

## 3. Allow guest read (so maintenance blocks the login screen too)

The gate runs **before** sign-in. For maintenance mode to block logged-out users
as well, the `acontrol` collection's **Read** permission must include **Any**
(guests). The data here is non-sensitive (flags, versions, store URLs, public
messages), so this is safe.

> If you leave it user-only, the gate still applies to signed-in users, but a
> logged-out user on the login screen won't be gated until they have a session.

## 4. What each field does

| Field          | Effect |
| -------------- | ------ |
| `maintenance`  | `true` → full-screen **"We'll be right back"**; blocks everyone (incl. login). Wins over everything. |
| `minVersion`   | Installed version **below** this → blocking **"Update required"** screen. |
| `latestVersion`| Installed version **below** this (but ≥ `minVersion`) → dismissible **"Update available"** sheet. |
| `iosUrl` / `androidUrl` | URL the "Update now" button opens (per platform). |

Versions compare as dotted numbers (`1.2.0`) against the build's
`expo-application` version (`app.json` → `expo.version`, currently `1.0.0`).

## 5. Common operations (edit the doc, then save)

**Maintenance mode on** → `maintenance = true` (+ `maintenanceMessage`).
**Re-open the app** → `maintenance = false`.
**Force everyone onto ≥ 1.2.0** → `minVersion = 1.2.0` (+ store URLs).
**Optional nudge to 1.3.0** → `latestVersion = 1.3.0` (keep `minVersion` low).

Changes take effect the next time the app launches or is foregrounded.

## Safety

Fully **fail-open**: a missing collection/doc, a permission error, or a network
error all resolve to "allow", so a config mistake can never lock users out.
