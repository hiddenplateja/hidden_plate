// src/services/appwrite.ts
// Appwrite client + config. Single source of truth.
// Validates env vars at startup so missing config fails loud, not silent.

import "react-native-url-polyfill/auto"; // MUST be imported before Appwrite SDK

import { Account, Client, Databases, Functions, Storage, Teams } from "react-native-appwrite";
import { getAppwriteConfiguration } from "@/services/appwriteConfiguration";
export const appwriteConfig = getAppwriteConfiguration();

export const client = new Client()
  .setEndpoint(appwriteConfig.endpoint)
  .setProject(appwriteConfig.projectId)
  .setPlatform(appwriteConfig.platform);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const teams = new Teams(client);
