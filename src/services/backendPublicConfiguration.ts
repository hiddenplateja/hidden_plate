// Public mobile-client configuration, not server credentials. RLS and Worker
// authorization enforce access. Never put service-role/R2/SMTP secrets here.
export const BACKEND_PUBLIC_CONFIGURATION = Object.freeze({
  supabaseUrl: "https://ezhnntopskzlhllljbdv.supabase.co",
  publishableKey: "sb_publishable_J0bIHdDlIy1HI7efrupHeA_H45Jjalx",
  mediaUrl: "https://hidden-plate-pay.hiddenplate-ja.workers.dev",
});
