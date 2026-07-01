// src/services/appwrite.ts
// Appwrite client + config. Single source of truth.
// Validates env vars at startup so missing config fails loud, not silent.

import "react-native-url-polyfill/auto"; // MUST be imported before Appwrite SDK

import Constants from "expo-constants";
import {
  Account,
  Client,
  Databases,
  Functions,
  Storage,
  Teams,
} from "react-native-appwrite";

interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  platform: string;
  databaseId: string;
  /** Appwrite Team ID whose members are admins. "" = admin features off. */
  adminTeamId: string;
  collections: {
    users: string;
    restaurants: string;
    reviews: string;
    reviewLikes: string;
    reviewComments: string;
    saved: string;
    reviewReports: string;
    follows: string;
    blocks: string;
    notifications: string;
    pushTokens: string;
    /** Optional single-doc config (e.g. Spot of the Day override). "" = unset. */
    appConfig: string;
    /** Optional unique-viewer log for restaurant view counts. "" = unset. */
    restaurantViews: string;
    /** Optional "claim your restaurant" ownership claims. "" = feature off. */
    restaurantClaims: string;
    /** Optional owner replies to reviews. "" = feature off. */
    reviewResponses: string;
    /** Optional user-curated shareable Collections. "" = feature off. */
    lists: string;
    /** Optional in-app "Report a bug" reports. "" = feature off. */
    bugReports: string;
    /** Optional owner-editable menu override docs. "" = feature off. */
    restaurantMenus: string;
    /** Optional app-control doc (maintenance + version gate). "" = gate off. */
    acontrol: string;
  };
  buckets: {
    media: string;
  };
  // Function IDs — set in app.json/env. Used for executing server-side fns
  // (push send, etc). Function deployment is a manual step in the Appwrite
  // Console; this just lets us reference the deployed function by ID.
  functions: {
    sendNotification: string;
    deleteAccount: string;
  };
}

function requireEnv(key: string): string {
  // Generic accessor (key is a param) — Expo exposes EXPO_PUBLIC_* on the
  // runtime process.env, so dynamic access is intentional here.
  // eslint-disable-next-line expo/no-dynamic-env-var
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Check your .env.local file and restart Metro with --clear.`,
    );
  }
  return value;
}

// Optional env var — won't throw if missing. Useful for functions that
// might not be deployed yet during local dev.
function optionalEnv(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

const platform =
  Constants.expoConfig?.ios?.bundleIdentifier ??
  Constants.expoConfig?.android?.package ??
  "com.hiddenplate.app";

export const appwriteConfig: AppwriteConfig = {
  endpoint: requireEnv("EXPO_PUBLIC_APPWRITE_ENDPOINT"),
  projectId: requireEnv("EXPO_PUBLIC_APPWRITE_PROJECT_ID"),
  platform,
  databaseId: requireEnv("EXPO_PUBLIC_APPWRITE_DATABASE_ID"),
  // Members of this Appwrite Team get the in-app Admin section. Optional —
  // admin features stay hidden/off when unset.
  adminTeamId: optionalEnv("EXPO_PUBLIC_APPWRITE_ADMIN_TEAM_ID", ""),
  collections: {
    users: requireEnv("EXPO_PUBLIC_APPWRITE_USERS_COLLECTION_ID"),
    restaurants: requireEnv("EXPO_PUBLIC_APPWRITE_RESTAURANTS_COLLECTION_ID"),
    reviews: requireEnv("EXPO_PUBLIC_APPWRITE_REVIEWS_COLLECTION_ID"),
    reviewLikes: requireEnv("EXPO_PUBLIC_APPWRITE_REVIEW_LIKES_COLLECTION_ID"),
    reviewComments: requireEnv(
      "EXPO_PUBLIC_APPWRITE_REVIEW_COMMENTS_COLLECTION_ID",
    ),
    saved: requireEnv("EXPO_PUBLIC_APPWRITE_SAVED_COLLECTION_ID"),
    reviewReports: requireEnv(
      "EXPO_PUBLIC_APPWRITE_REVIEW_REPORTS_COLLECTION_ID",
    ),
    follows: requireEnv("EXPO_PUBLIC_APPWRITE_FOLLOWS_COLLECTION_ID"),
    blocks: requireEnv("EXPO_PUBLIC_APPWRITE_BLOCKS_COLLECTION_ID"),
    notifications: requireEnv(
      "EXPO_PUBLIC_APPWRITE_NOTIFICATIONS_COLLECTION_ID",
    ),
    pushTokens: requireEnv("EXPO_PUBLIC_APPWRITE_PUSH_TOKENS_COLLECTION_ID"),
    // Optional — falls back to the automatic Spot-of-the-Day pick when unset.
    appConfig: optionalEnv("EXPO_PUBLIC_APPWRITE_APP_CONFIG_COLLECTION_ID", ""),
    // Optional — view tracking no-ops gracefully when unset.
    restaurantViews: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_RESTAURANT_VIEWS_COLLECTION_ID",
      "",
    ),
    // Optional — the "claim your restaurant" flow no-ops gracefully when unset.
    restaurantClaims: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_RESTAURANT_CLAIMS_COLLECTION_ID",
      "",
    ),
    // Optional — owner replies to reviews no-op gracefully when unset.
    reviewResponses: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_REVIEW_RESPONSES_COLLECTION_ID",
      "",
    ),
    // Optional — user-curated Collections no-op gracefully when unset.
    lists: optionalEnv("EXPO_PUBLIC_APPWRITE_LISTS_COLLECTION_ID", ""),
    // Optional — the in-app "Report a bug" form no-ops gracefully when unset.
    bugReports: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_BUG_REPORTS_COLLECTION_ID",
      "",
    ),
    // Optional — owner-editable menu overrides no-op gracefully when unset.
    restaurantMenus: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_RESTAURANT_MENUS_COLLECTION_ID",
      "",
    ),
    // Optional — maintenance + version gate. The app stays ungated when unset.
    acontrol: optionalEnv("EXPO_PUBLIC_APPWRITE_ACONTROL_COLLECTION_ID", ""),
  },
  buckets: {
    media: requireEnv("EXPO_PUBLIC_APPWRITE_MEDIA_BUCKET_ID"),
  },
  functions: {
    sendNotification: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_SEND_NOTIFICATION_FUNCTION_ID",
      "send-notification",
    ),
    deleteAccount: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_DELETE_ACCOUNT_FUNCTION_ID",
      "delete-account",
    ),
  },
};

export const client = new Client()
  .setEndpoint(appwriteConfig.endpoint)
  .setProject(appwriteConfig.projectId)
  .setPlatform(appwriteConfig.platform);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const teams = new Teams(client);
