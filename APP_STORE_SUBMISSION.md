# App Store Connect — submission content

Paste-ready answers for every form in the first submission. Play Console uses
the same substance (data safety form, listing copy, rating questionnaire) —
reuse from here. Keep this file in sync with the privacy policy
(hidden-plate-web `/privacy`) whenever data practices change.

---

## 1. App Information

| Field | Value |
| --- | --- |
| Name | Hidden Plate |
| Subtitle (30 chars) | `Jamaica's hidden food spots` |
| Primary category | Food & Drink |
| Secondary category | Travel |
| Content rights | Does not use third-party content requiring rights (user content is licensed via the Terms of Service) |
| Age rating | Answer the questionnaire per §4 — expected result **13+** |
| Copyright | © 2026 Hidden Plate |
| Support URL | `https://<your-domain>/support` |
| Marketing URL | `https://<your-domain>/` |
| Privacy Policy URL | `https://<your-domain>/privacy` |

---

## 2. App Privacy (nutrition labels)

**"Do you or your third-party partners collect data from this app?"** → **Yes**

Declare exactly these data types. For every one of them:
**Used for tracking? → NO** (no ads, no data brokers, no cross-app tracking).

| Data type (Apple taxonomy) | Collected? | Linked to identity? | Purpose |
| --- | --- | --- | --- |
| Contact Info → **Email Address** | Yes | **Linked** | App Functionality (sign-in, verification, security notices) |
| Contact Info → **Name** | Yes | **Linked** | App Functionality (display name on profile/reviews) |
| User Content → **Photos or Videos** | Yes | **Linked** | App Functionality (review/post photos, avatar) |
| User Content → **Other User Content** | Yes | **Linked** | App Functionality (reviews, posts, comments, lists) |
| Identifiers → **User ID** | Yes | **Linked** | App Functionality (account identity) |
| Diagnostics → **Crash Data** | Yes | **Linked** | App Functionality (Sentry crash reporting — reports are tagged with user id/username via `identifyUser`) |
| Location → **Coarse Location** | Yes | **Not linked** | App Functionality (nearby restaurants) |

Notes:

- **Location nuance:** the app requests precise device location but uses it
  in-memory on the device only — coordinates are never sent to or stored on
  the server (verified in the code: distance sorting is client-side). Under
  Apple's definition of "collect" (data transmitted off-device), you could
  legitimately omit Location entirely. Declaring **Coarse Location, not
  linked** is the conservative choice that can never be called
  under-declaration; either answer is defensible, pick one and match the
  Play data-safety form to it.
- **Crash Data is "linked"** because `src/services/sentry.ts` calls
  `identifyUser({ id, username })`. If you ever stop identifying users to
  Sentry, this can drop to "not linked."
- Do **not** declare: Purchases (paid features are flagged off at launch),
  Usage Data / Analytics (none), Contacts, Health, Financial info, Browsing
  history, Search history (searches are not retained as history server-side).

---

## 3. Store listing copy

**Promotional text** (170 chars, editable without review):

> Every yard has a spot worth finding. Real reviews of real Jamaican spots —
> from roadside jerk pans to seaside grills — across all 14 parishes.

**Description:**

> Jamaica's best food isn't in guidebooks. It's the jerk pan that lights up
> after dark, the cookshop with three tables and a line out the door, the
> seaside grill only the locals know. Hidden Plate is where you find it.
>
> REAL REVIEWS FROM REAL PEOPLE
> Every review on Hidden Plate is written by a real diner with a real name.
> No paid placements, no fake stars. Restaurant owners can claim their spot
> and reply to reviews — but they can't rate themselves.
>
> THE WHOLE ISLAND, MAPPED
> Browse the map or your parish feed to find spots near you, with photos,
> menus, and opening hours from the community. From Kingston to Negril,
> Portland to St. Elizabeth — all fourteen parishes, one app.
>
> YOUR FOOD PEOPLE
> Follow reviewers whose taste you rate. Like and discuss reviews and posts.
> Keep private lists of spots you want to try, and share collections like
> "best jerk in Kingston" with friends.
>
> EARN YOUR STRIPES
> Write reviews and explore new parishes to earn reviewer badges — from your
> first review all the way to Island Master.
>
> FOR RESTAURANT OWNERS
> Claim your listing free of charge: keep your details accurate, upload your
> menu, and respond to your customers.
>
> A COMMUNITY WITH STANDARDS
> Genuine experiences only. Every review, post, and comment can be reported
> in one tap, anyone can be blocked, and a real moderation team reviews
> reports quickly. See our terms and privacy policy for the details.
>
> Find your next favorite before the crowd does. Walk good. 🇯🇲

**Keywords** (100 chars max — this string is 96):

```
jamaica,jamaican,food,restaurant,reviews,jerk,caribbean,kingston,local,eats,dining,island,foodie
```

(Don't waste keyword characters on "hidden" or "plate" — the app name is
already indexed.)

---

## 4. Age rating questionnaire

Answer honestly; these are the accurate answers for this app:

| Question | Answer |
| --- | --- |
| Violence (cartoon/realistic), horror themes | None |
| Sexual content or nudity | None |
| Profanity or crude humor | None |
| Alcohol, tobacco, or drug use or references | **Infrequent/Mild** (restaurant listings and reviews can reference bars and drinks — same answer Yelp gives) |
| Simulated gambling / contests | None |
| Medical/treatment information | None |
| Unrestricted web access | No |
| **User-generated content** | **Yes** — and when asked about safety controls: content reporting ✓, user blocking ✓, content moderation ✓ (see §5) |
| Parental/in-app controls | No |

Expected computed rating: **13+** — which matches the Terms of Service age
requirement (13+). If the questionnaire lands on a different rating, don't
fight it in the answers; tell me and we'll look at which response caused it.

---

## 5. App Review Information

**Sign-in required → YES. Demo account:**

Create this BEFORE submitting (I can't create it for you):

1. In the app, sign up with a fresh email you control, e.g.
   `applereview@hiddenplateja.com` (a mailbox alias is fine — you need the
   OTP once).
2. Complete the email OTP verification during signup so the account is
   **pre-verified** — the reviewer must never need access to the mailbox.
3. Give it a plain profile (username like `applereview`), write one sample
   review, save one restaurant — so every tab has content.
4. Do NOT add it to the admins team, and don't set it up as a restaurant
   owner.
5. Enter the credentials in App Review Information and **test them on a
   clean install the day you submit.**

**Notes for App Review** (paste into the Notes field):

> Hidden Plate is a restaurant discovery and review community for Jamaica.
>
> SIGN-IN: Use the demo account provided (email + password). The account is
> already email-verified. Sign in with Apple and Google are also supported
> on the welcome screen. New signups require a one-time email verification
> code, so the demo account is the fastest path.
>
> USER-GENERATED CONTENT — moderation measures in place:
> • EULA/Terms: users agree to terms prohibiting objectionable content
>   (in-app: Profile → menu → Terms & Policies; web: <your-domain>/terms).
> • Reporting: every review, community post, and comment has a one-tap
>   Report option (menu on each item).
> • Blocking: any user can be blocked from their profile (⋯ menu); blocking
>   hides all content in both directions immediately.
> • Automated safeguard: content that accumulates reports is hidden
>   automatically pending review.
> • Human moderation: reports flow to an in-app admin review queue and are
>   actioned within 24 hours; violating content is removed and repeat
>   offenders are banned. URLs are blocked in user content to prevent spam.
>
> ACCOUNT DELETION: available in-app at Profile → Settings → Delete account
> (immediate, self-serve), and on the web at <your-domain>/delete-account.
>
> LOCATION: used only to show nearby restaurants and sort the feed; it is
> processed on-device and never stored on our servers. The app is fully
> usable without granting location — restaurants can be browsed by parish.
> Note: listings are Jamaica-based, so with location granted outside Jamaica
> the "near you" rail may be empty; the parish feeds and map still show all
> content.
>
> PAYMENTS: this version contains no in-app purchases or paid features.
>
> Contact for review questions: support@hiddenplateja.com

---

## 6. Play Console mapping (reuse)

- §2 → Data safety form: same data types; mark everything "collected", not
  shared, encrypted in transit, deletable; deletion URL
  `https://<your-domain>/delete-account`.
- §3 → Store listing (short description, 80 chars: "Real reviews of
  Jamaica's best-kept food spots — every parish, one app.").
- §4 → IARC content rating questionnaire (same substance answers).
- §5 → App content → App access: same demo credentials; UGC declarations:
  reporting ✓ blocking ✓ moderation ✓; child safety standards URL
  `https://<your-domain>/child-safety`.
