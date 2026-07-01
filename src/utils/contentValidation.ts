// src/utils/contentValidation.ts
// Shared input-validation helpers for user-generated content.
//
// URL / contact detection:
//   Used to reject external links (and link-like contact info) in reviews and
//   comments. Input is first NORMALIZED to defeat common obfuscation, then
//   matched against a URL regex and an email regex.
//
//   Caught after normalization:
//     - http:// / https:// / ftp:// prefixes
//     - www. prefixes and bare domains with a recognizable TLD (foo.com, baz.gov.jm)
//     - Bracketed / worded dots: "scotchies[dot]com", "scotchies (dot) com",
//       "scotchies dot com", "scotchies . com", "d0t"
//     - Protocol obfuscation: "hxxp://", "hxxps://"
//     - Unicode dot homoglyphs (full-width, ideographic, one-dot leader, etc.)
//       and zero-width / soft-hyphen characters slipped between letters
//     - Email addresses, including "name (at) gmail dot com" obfuscation
//
//   Still NOT caught (accepted — bypass requires real determination):
//     - Unicode lookalike LETTERS in the domain body (e.g. Cyrillic "o" for "o")
//     - Wildly creative spellings ("dee oh tee", spelled-out TLDs)
//
//   IMPORTANT — this is a UX / soft-spam filter, NOT a security boundary.
//   It runs in the client app, which a modified build can bypass. There is no
//   server-side Appwrite Function re-running this check; the only true
//   server-side enforcement is the reviews collection's attribute constraints
//   (rating min/max, comment max-length) configured in the Appwrite console.

// URL regex captures three shapes against the *normalized* string:
//   1. (https?|ftp)://...               → explicit protocol
//   2. www.<something>.<tld>            → www-prefixed
//   3. <word>.<tld> where TLD looks real → bare domain
//
// The TLD list is intentionally short: common ones + .jm (local relevance).
// Adding every ICANN TLD inflates the regex without much benefit; the goal
// is to block casual spam, not be a perfect filter.
const URL_REGEX =
  /(\b(?:https?|ftp):\/\/[^\s]+)|(\bwww\.[^\s]+\.[a-z]{2,}\b)|(\b[a-z0-9-]+\.(?:com|net|org|io|co|app|dev|me|info|biz|ly|gov|edu|jm)(?:\.[a-z]{2})?\b)/i;

// Matches an email once "(at)"/" at " obfuscation has been folded back to "@".
const EMAIL_REGEX = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

// Invisible characters (zero-width space/joiner/non-joiner, BOM, soft hyphen)
// used to break up domains so the regex can't see them.
const INVISIBLE_CHARS = /[​‌‍﻿­]/g;

// Unicode "dot" homoglyphs that stand in for a normal period.
const DOT_HOMOGLYPHS = /[．。․˙܁܂]/g;

// Fold common obfuscation back into canonical URL/email punctuation so the
// regexes above can see it. Every replacement requires an alphanumeric on at
// least one side (via a lookahead so chained forms like "a dot b dot c" all
// collapse), and matches are still gated by a real TLD — so incidental prose
// ("I dot the i's", "meet at noon") normalizes to something harmless that
// neither regex accepts.
function normalizeForDetection(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(INVISIBLE_CHARS, "")
      .replace(DOT_HOMOGLYPHS, ".")
      // "hxxp://" / "h**ps://" → "http"/"https"
      .replace(/h[x*#]{2}(ps?)\b/g, "htt$1")
      // Bracketed literal dot / at: "[.]", "(.)", "[@]", "(at)" → "." / "@"
      .replace(/[([{]\s*\.\s*[)\]}]/g, ".")
      .replace(/[([{]\s*(?:@|at)\s*[)\]}]/g, "@")
      // Worded/bracketed dot between alphanumerics: "a dot b", "a (dot) b", "d0t"
      .replace(
        /([a-z0-9])\s*[([{]?\s*\b(?:dot|d0t)\b\s*[)\]}]?\s*(?=[a-z0-9])/g,
        "$1.",
      )
      // Spaced literal dot: "example . com"
      .replace(/([a-z0-9])\s+\.\s+(?=[a-z0-9])/g, "$1.")
      // Worded "at" between alphanumerics → "@" (for emails)
      .replace(/([a-z0-9])\s+at\s+(?=[a-z0-9])/g, "$1@")
  );
}

export function containsUrl(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeForDetection(text);
  return URL_REGEX.test(normalized) || EMAIL_REGEX.test(normalized);
}

/**
 * Friendly, user-facing error message for the URL-rejection case.
 * Centralized so it stays consistent across reviews, comments, etc.
 */
export const URL_REJECTION_MESSAGE =
  "Links aren't allowed. Please remove any URLs from your text.";
