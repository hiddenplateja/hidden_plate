// src/constants/features.ts
// Build-time feature flags.

/**
 * Master switch for monetization surfaces: the paid "Promote / feature this
 * restaurant" boost, the paid listing-renewal window, and the "Go Premium"
 * upsell. OFF for the initial store release so the app ships fully free and
 * can't be rejected for non-functional in-app purchases (App Store 2.1 /
 * 3.1.1, Play billing policy).
 *
 * What stays ON when this is false:
 *   - The "claim your restaurant" flow (free — ownership, menu editing, replies).
 *   - Admin-side featuring/spotlight (manual, internal, not a purchase).
 *
 * What turns OFF:
 *   - Every user-facing purchase entry point (Promote, Manage/renew listing).
 *   - The Premium upsell in the community drawer.
 *   - Listing-window expiry hiding — claimed restaurants stay visible forever
 *     rather than being hidden when an (unrenewable) paid window lapses.
 *
 * Flip to true once RevenueCat products are live and reviewed.
 */
export const PAID_FEATURES_ENABLED = false;
