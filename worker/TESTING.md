# Hidden Plate — featured-placement testing runbook (RevenueCat)

Featured placement is a **one-time in-app purchase** (consumable) via RevenueCat.
The Cloudflare Worker is a **webhook receiver** that activates the feature after
RevenueCat confirms the purchase server-to-server.

> **Live-debug tool:** keep `npx wrangler tail` open in a second terminal to
> stream the worker's logs while you test.

---

## A. Worker is alive
- [ ] `cd worker && npx wrangler dev` → open <http://localhost:8787/> → `hidden-plate-pay ok`
- [ ] After `npx wrangler deploy`, open `https://hidden-plate-pay.<you>.workers.dev/` → same

## B. Webhook auth + config (no app needed)
Test the deployed worker with curl.exe (PowerShell's `curl` is an alias — use `curl.exe`).

- [ ] **Rejects no/wrong auth:**
      ```
      curl.exe -i -X POST "https://hidden-plate-pay.<you>.workers.dev/revenuecat/webhook" -H "content-type: application/json" -d "{}"
      ```
      → `401 unauthorized` (proves the shared secret gate works).
- [ ] **Accepts the TEST event with the right auth:**
      ```
      curl.exe -i -X POST "https://hidden-plate-pay.<you>.workers.dev/revenuecat/webhook" ^
        -H "authorization: <your REVENUECAT_WEBHOOK_AUTH>" ^
        -H "content-type: application/json" ^
        -d "{\"event\":{\"type\":\"TEST\",\"id\":\"t1\"}}"
      ```
      → `200 ok`.

## C. Forged-purchase / ownership guard (no app, the important one)
Simulate a real purchase event for a restaurant the buyer does **not** own.

- [ ] POST a `NON_RENEWING_PURCHASE` with the correct auth header but an
      `app_user_id` that isn't the restaurant's `ownerId`:
      ```
      curl.exe -i -X POST ".../revenuecat/webhook" ^
        -H "authorization: <secret>" -H "content-type: application/json" ^
        -d "{\"event\":{\"type\":\"NON_RENEWING_PURCHASE\",\"id\":\"evt-fake-1\",\"app_user_id\":\"not-the-owner\",\"product_id\":\"feature_7d\",\"subscriber_attributes\":{\"feature_restaurant_id\":{\"value\":\"<a real restaurant id>\"}}}}"
      ```
      → `200 ok`, but `wrangler tail` logs **"ownership mismatch"** and the
      restaurant's `isFeatured` stays unchanged. ✅ The webhook refuses to feature
      a restaurant the buyer doesn't own, even with a valid auth header.

## D. Real purchase in the app (RevenueCat sandbox)

**One-time setup**
- [ ] RevenueCat project created; **iOS + Android public SDK keys** in app `.env.local`:
      `EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_…` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_…` → restart Metro `--clear`
- [ ] App Store Connect / Play Console: **consumable** products `feature_7d`, `feature_30d` created
- [ ] RevenueCat: those products added to the **current Offering**; webhook → worker URL with the `Authorization` header = your `REVENUECAT_WEBHOOK_AUTH`
- [ ] `featurePurchases` collection exists; `restaurants` has `ownerId` + `featuredUntil`
- [ ] **Dev client rebuilt** with `react-native-purchases` (EAS build or `expo run:android` / `run:ios`) — it's a native module, not in your old build
- [ ] A **sandbox tester** account (App Store Connect → Sandbox; Play → License testers) and you're signed into it on-device
- [ ] You're the **verified owner** of a test restaurant (claim → approve in Admin → Claims)

**Run**
- [ ] Restaurant detail → owner card → **Promote** → pick a plan → **Continue to payment**
- [ ] Native store purchase sheet appears with the product/price → confirm with the sandbox tester
- [ ] App shows **"You're featured! 🎉"**; within ~a minute the banner flips to **"Featured until <date>"**
- [ ] `wrangler tail` shows the `NON_RENEWING_PURCHASE` event handled
- [ ] Appwrite: restaurant `isFeatured=true`, `featuredUntil` ≈ now + plan days; `featurePurchases` doc `status="completed"` (doc id = the RC event id)

## E. Edge cases
- [ ] **Cancel:** dismiss the store sheet → no alert, no charge, flags unchanged (`cancelled`)
- [ ] **Idempotency:** in RevenueCat → the purchase → **"Resend event"** (or it auto-retries) → `featuredUntil` does **not** jump again (same event id → no double-stack)
- [ ] **Renewal stacks:** buy a second plan while still featured → `featuredUntil` extends from the existing expiry, not from today
- [ ] **Unknown product:** POST a webhook with `product_id":"nope"` → `200 ok`, logs "unknown product", no change

---

## Common failures → fixes
| Symptom | Likely cause |
|---|---|
| Store sheet never appears | Product not in the **current Offering**, or dev client not rebuilt with the SDK, or wrong/blank SDK key for the platform |
| Purchase succeeds but never features | Webhook not configured, wrong worker URL, or `Authorization` value ≠ `REVENUECAT_WEBHOOK_AUTH` → check `wrangler tail` for 401s |
| Worker 500s in `tail` | Wrong `APPWRITE_ENDPOINT` region or `APPWRITE_API_KEY` missing `databases.*` scopes |
| "ownership mismatch" in logs | The buyer's Appwrite id ≠ restaurant `ownerId` (RC `app_user_id` must be the Appwrite user id — set via `Purchases.configure({ appUserID })`) |

## Go-live
When sandbox passes: submit the IAP products for review with your app build,
ensure the paid-apps/banking agreements are active in both stores, and switch
the webhook/keys to production. No worker code change needed.
