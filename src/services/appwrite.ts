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
} from "react-native-appwrite";

interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  platform: string;
  databaseId: string;
  collections: {
    users: string;
    restaurants: string;
    reviews: string;
    reviewLikes: string;
    reviewComments: string;
    saved: string;
    reviewReports: string;
    follows: string;
    notifications: string;
    pushTokens: string;
  };
  buckets: {
    media: string;
  };
  // Function IDs — set in app.json/env. Used for executing server-side fns
  // (push send, etc). Function deployment is a manual step in the Appwrite
  // Console; this just lets us reference the deployed function by ID.
  functions: {
    sendNotification: string;
  };
}

function requireEnv(key: string): string {
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
    notifications: requireEnv(
      "EXPO_PUBLIC_APPWRITE_NOTIFICATIONS_COLLECTION_ID",
    ),
    pushTokens: requireEnv("EXPO_PUBLIC_APPWRITE_PUSH_TOKENS_COLLECTION_ID"),
  },
  buckets: {
    media: requireEnv("EXPO_PUBLIC_APPWRITE_MEDIA_BUCKET_ID"),
  },
  functions: {
    // Function ID is set after deployment. We default to "send-notification"
    // (the conventional ID) but allow override via env. If the function isn't
    // deployed yet, calls will fail gracefully via try/catch in trigger code.
    sendNotification: optionalEnv(
      "EXPO_PUBLIC_APPWRITE_SEND_NOTIFICATION_FUNCTION_ID",
      "send-notification",
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
