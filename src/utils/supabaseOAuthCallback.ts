/** Accept only our exact callback and PKCE code; never import URL token fragments. */
export const SUPABASE_OAUTH_REDIRECT = "hiddenplate://auth";

export function readSupabaseOAuthCode(callback: string): string {
  const url = new URL(callback);
  if (`${url.protocol}//${url.host}${url.pathname}` !== SUPABASE_OAUTH_REDIRECT) {
    throw new Error("Unexpected sign-in redirect. Please try again.");
  }
  if (url.searchParams.has("error")) throw new Error("Sign-in wasn't completed. Please try again.");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.getAll("code").length !== 1 || url.hash) {
    throw new Error("Invalid sign-in response. Please try again.");
  }
  return code;
}
