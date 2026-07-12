// src/services/admin.ts
// Admin authorization + dashboard stats.
//
// Authorization model: Appwrite Teams. A user is an admin when they belong to
// the configured admins team (EXPO_PUBLIC_APPWRITE_ADMIN_TEAM_ID), or to a team
// literally named "admins". Team membership also secures writes server-side —
// the relevant collections grant write permission to that team, so non-members
// physically can't edit/delete/approve even if they reach the screens.
//
// Everything here is tolerant: failures resolve to "not admin" / zeroed stats
// rather than throwing, so a hiccup never traps a user or blanks the dashboard.

import { Query } from "react-native-appwrite";

import { appwriteConfig, databases, teams } from "@/services/appwrite";

/**
 * Whether the signed-in user is an admin (member of the admins team).
 * Returns false when signed out, unconfigured, or on any error.
 */
export async function checkIsAdmin(): Promise<boolean> {
  const teamId = appwriteConfig.adminTeamId;
  try {
    const res = await teams.list();
    return res.teams.some(
      (t) => (!!teamId && t.$id === teamId) || t.name.toLowerCase() === "admins",
    );
  } catch {
    return false;
  }
}

export interface AdminStats {
  restaurantsTotal: number;
  restaurantsActive: number;
  restaurantsPending: number;
  reviews: number;
  users: number;
  reports: number;
  commentReports: number;
  postReports: number;
  postCommentReports: number;
  claims: number;
}

const EMPTY_STATS: AdminStats = {
  restaurantsTotal: 0,
  restaurantsActive: 0,
  restaurantsPending: 0,
  reviews: 0,
  users: 0,
  reports: 0,
  commentReports: 0,
  postReports: 0,
  postCommentReports: 0,
  claims: 0,
};

/**
 * Count of documents matching `queries` in a collection. Reads the query
 * `total` (Appwrite returns the full match count, not just the page), so a
 * limit(1) page is enough. Tolerant — returns 0 on failure/unconfigured.
 */
async function countDocuments(
  collectionId: string,
  queries: string[] = [],
): Promise<number> {
  if (!collectionId) return 0;
  try {
    const res = await databases.listDocuments(appwriteConfig.databaseId, collectionId, [
      ...queries,
      Query.limit(1),
    ]);
    return res.total;
  } catch {
    return 0;
  }
}

/** Overview counts for the admin dashboard. Tolerant end-to-end. */
export async function getAdminStats(): Promise<AdminStats> {
  const { collections } = appwriteConfig;
  try {
    const [
      restaurantsTotal,
      restaurantsActive,
      reviews,
      users,
      reports,
      commentReports,
      postReports,
      postCommentReports,
      claims,
    ] = await Promise.all([
      countDocuments(collections.restaurants),
      countDocuments(collections.restaurants, [Query.equal("isActive", true)]),
      countDocuments(collections.reviews),
      countDocuments(collections.users),
      countDocuments(collections.reviewReports),
      countDocuments(collections.commentReports),
      countDocuments(collections.postReports),
      countDocuments(collections.postCommentReports),
      countDocuments(collections.restaurantClaims, [
        Query.equal("status", "pending"),
      ]),
    ]);
    return {
      restaurantsTotal,
      restaurantsActive,
      restaurantsPending: Math.max(0, restaurantsTotal - restaurantsActive),
      reviews,
      users,
      reports,
      commentReports,
      postReports,
      postCommentReports,
      claims,
    };
  } catch {
    return EMPTY_STATS;
  }
}
