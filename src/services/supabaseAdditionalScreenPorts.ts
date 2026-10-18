// Staged original-name contracts; every legacy import is erased by TypeScript.
import type { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
import type * as Saved from "@/services/saved";
import type * as Follows from "@/services/follows";
import type * as Blocks from "@/services/blocks";
import type * as Lists from "@/services/lists";
import type * as Posts from "@/services/posts";
import type * as ReviewLikes from "@/services/reviewLikes";
import type * as ReviewComments from "@/services/reviewComments";
import type * as PostLikes from "@/services/postLikes";
import type * as PostComments from "@/services/postComments";
import type * as Notifications from "@/services/notifications";
import type * as Preferences from "@/services/userPreferences";
import type * as Reports from "@/services/reports";
import type * as BugReports from "@/services/bugReports";
import type * as Claims from "@/services/claims";
import type * as Menus from "@/services/restaurantMenus";
import type * as Replies from "@/services/reviewResponses";
import type * as Views from "@/services/restaurantViews";
import type * as Spotlight from "@/services/spotOfTheDay";
import type * as RemoteConfig from "@/services/remoteConfig";
import type * as Deletion from "@/services/accountDeletion";
import type * as Restaurants from "@/services/restaurants";
import type * as Badges from "@/services/badges";
import { parseMenu, serializeMenu } from "@/utils/restaurantMenuCodec";
import { DEFAULT_PREFERENCES } from "@/utils/userPreferencesModel";

type Gateway = ReturnType<typeof createSupabaseTestBackend>;
type AsyncFunctions<T> = { [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: T[K] };
const enabled = () => true;

export async function loadSupabaseSavedScreenPort(gateway: Gateway) {
  const [module, relationships] = await Promise.all([gateway.load("saved"), gateway.load("relationships")]);
  return Object.freeze({ getSavedStatus: module.getSupabaseScreenSavedStatus, toggleSaved: module.toggleSupabaseScreenSaved,
    listSavedByUser: module.listSupabaseScreenSavedByUser, listSavedRestaurants: module.listSupabaseScreenSavedRestaurants,
    getMySavedCount: relationships.getMySupabaseSavedCount } satisfies AsyncFunctions<typeof Saved>);
}
export async function loadSupabaseBadgeScreenPort(gateway: Gateway) {
  const module = await gateway.load("badges");
  return Object.freeze({ syncEarnedBadges: module.syncSupabaseEarnedBadges } satisfies AsyncFunctions<typeof Badges>);
}
export async function loadSupabaseFollowScreenPort(gateway: Gateway) {
  const module = await gateway.load("relationships");
  return Object.freeze({ followUser: module.followSupabaseUser, unfollowUser: module.unfollowSupabaseUser,
    isFollowing: module.isSupabaseFollowing, getFollowingIds: module.getSupabaseFollowingIds, getFollowerIds: module.getSupabaseFollowerIds,
    getFollowCounts: module.getSupabaseFollowCounts, listFollowers: module.listSupabaseFollowers,
    listFollowing: module.listSupabaseFollowing, getFollowingSetForUsers: module.getSupabaseFollowingSetForUsers } satisfies AsyncFunctions<typeof Follows>);
}
export async function loadSupabaseBlockScreenPort(gateway: Gateway) {
  const [module, users] = await Promise.all([gateway.load("relationships"), gateway.load("users")]);
  return Object.freeze({ blockUser: (id: string) => module.setSupabaseBlocked(id, true),
    unblockUser: (id: string) => module.setSupabaseBlocked(id, false), getHiddenUserIds: module.getSupabaseHiddenUserIds,
    isBlocked: module.isSupabaseBlocked, listBlockedUsers: async () => (await module.listSupabaseBlockedProfiles()).map(users.mapSupabasePublicProfile)
  } satisfies AsyncFunctions<typeof Blocks>);
}
export async function loadSupabaseCollectionScreenPort(gateway: Gateway) {
  const module = await gateway.load("collections");
  return Object.freeze({ listsEnabled: enabled, getList: module.getSupabaseCollection, createList: module.createSupabaseCollection,
    updateList: module.updateSupabaseCollection, deleteList: module.deleteSupabaseCollection,
    listMyLists: () => module.listSupabaseCollections(), listPublicListsByUser: (id: string) => module.listSupabaseCollections(id, true),
    addToList: (id: string, restaurantId: string) => module.changeSupabaseCollectionMembership(id, restaurantId, true),
    removeFromList: (id: string, restaurantId: string) => module.changeSupabaseCollectionMembership(id, restaurantId, false),
    getListWithRestaurants: module.getSupabaseCollectionWithRestaurants } satisfies AsyncFunctions<typeof Lists> & Pick<typeof Lists, "listsEnabled">);
}
export async function loadSupabasePostScreenPort(gateway: Gateway) {
  const module = await gateway.load("posts");
  return Object.freeze({ postsEnabled: module.supabasePostsEnabled, POST_MAX_LENGTH: 500, POST_MAX_IMAGES: 4,
    createPost: module.createSupabasePost, getPostById: module.getSupabasePostById, deletePost: module.deleteSupabasePost,
    listLatestPosts: module.listSupabaseLatestPosts, listPostsByFollowing: module.listSupabasePostsByFollowing
  } satisfies AsyncFunctions<typeof Posts> & Pick<typeof Posts, "postsEnabled" | "POST_MAX_LENGTH" | "POST_MAX_IMAGES">);
}
export async function loadSupabaseReviewLikeScreenPort(gateway: Gateway) {
  const [module, liked] = await Promise.all([gateway.load("social"), gateway.load("likedContent")]);
  return Object.freeze({ likeReview: module.likeSupabaseReview, unlikeReview: module.unlikeSupabaseReview,
    hasUserLiked: module.hasSupabaseUserLikedReview, getLikedReviewIds: module.getSupabaseLikedReviewIds,
    listLikedReviewsByUser: liked.listSupabaseLikedReviewsByUser } satisfies AsyncFunctions<typeof ReviewLikes>);
}
export async function loadSupabaseReviewCommentScreenPort(gateway: Gateway) {
  const module = await gateway.load("social");
  return Object.freeze({ listCommentsForReview: module.listSupabaseComments, getCommentById: module.getSupabaseCommentById,
    addComment: module.addSupabaseReviewComment, deleteComment: module.deleteSupabaseComment } satisfies AsyncFunctions<typeof ReviewComments>);
}
export async function loadSupabasePostLikeScreenPort(gateway: Gateway) {
  const [module, liked] = await Promise.all([gateway.load("social"), gateway.load("likedContent")]);
  return Object.freeze({ postLikesEnabled: enabled, likePost: module.likeSupabasePost, unlikePost: module.unlikeSupabasePost,
    hasUserLikedPost: module.hasSupabaseUserLikedPost, getPostLikeCount: module.getSupabasePostLikeCount,
    getLikedPostIds: module.getSupabaseLikedPostIds, getPostLikeCounts: module.getSupabasePostLikeCounts,
    listLikedPostsByUser: liked.listSupabaseLikedPostsByUser } satisfies AsyncFunctions<typeof PostLikes> & Pick<typeof PostLikes, "postLikesEnabled">);
}
export async function loadSupabasePostCommentScreenPort(gateway: Gateway) {
  const module = await gateway.load("social");
  return Object.freeze({ postCommentsEnabled: enabled, POST_COMMENT_MAX_LENGTH: 1000,
    listCommentsForPost: module.listSupabaseCommentsForPost, getPostCommentById: module.getSupabasePostCommentById,
    addPostComment: module.addSupabasePostComment, deletePostComment: module.deleteSupabasePostComment,
    getPostCommentCounts: module.getSupabasePostCommentCounts
  } satisfies AsyncFunctions<typeof PostComments> & Pick<typeof PostComments, "postCommentsEnabled" | "POST_COMMENT_MAX_LENGTH">);
}
export async function loadSupabaseNotificationScreenPort(gateway: Gateway) {
  const module = await gateway.load("notifications");
  // No client notificationTriggers/dedupe reads: Postgres owns notification
  // creation/deduplication. Do not read another member's private inbox.
  return Object.freeze({ listMyNotifications: module.listSupabaseNotifications, getUnreadCount: module.getSupabaseUnreadCount,
    markRead: module.markSupabaseNotificationRead, markAllRead: module.markAllSupabaseNotificationsRead,
    deleteNotification: module.deleteSupabaseNotification
  } satisfies AsyncFunctions<Omit<typeof Notifications, "hasRecentSimilarNotification">>);
}
export async function loadSupabasePreferenceScreenPort(gateway: Gateway) {
  const module = await gateway.load("preferences");
  return Object.freeze({ DEFAULT_PREFERENCES, getUserPreferences: module.getSupabaseUserPreferences, updateUserPreferences: module.updateSupabaseUserPreferences,
    getTastePreferences: async () => { const prefs = await module.getSupabaseUserPreferences();
      return { favoriteCuisines: prefs.favoriteCuisines, favoriteParishes: prefs.favoriteParishes }; },
    setOnboardingPending: async (pending: boolean) => { await module.updateSupabaseUserPreferences({ onboardingPending: pending }); },
    completeOnboarding: async (taste: Parameters<typeof Preferences.completeOnboarding>[0]) => {
      await module.updateSupabaseUserPreferences({ ...taste, onboardingPending: false, seenBadgeIds: [] });
    } } satisfies AsyncFunctions<typeof Preferences> & Pick<typeof Preferences, "DEFAULT_PREFERENCES">);
}
export async function loadSupabaseReportScreenPort(gateway: Gateway) {
  const module = await gateway.load("reports");
  return Object.freeze({ commentReportsEnabled: enabled, postReportsEnabled: enabled, postCommentReportsEnabled: enabled,
    reportReview: module.reportSupabaseReview, reportComment: module.reportSupabaseComment, reportPost: module.reportSupabasePost,
    reportPostComment: module.reportSupabasePostComment, hasUserReported: module.hasSupabaseUserReported,
    listReports: module.listSupabaseReports, deleteReport: module.deleteSupabaseReport,
    listCommentReports: module.listSupabaseCommentReports, deleteCommentReport: module.deleteSupabaseCommentReport,
    listPostReports: module.listSupabasePostReports, deletePostReport: module.deleteSupabasePostReport,
    listPostCommentReports: module.listSupabasePostCommentReports, deletePostCommentReport: module.deleteSupabasePostCommentReport
  } satisfies AsyncFunctions<typeof Reports> & Pick<typeof Reports, "commentReportsEnabled" | "postReportsEnabled" | "postCommentReportsEnabled">);
}
export async function loadSupabaseBugReportScreenPort(gateway: Gateway) {
  const module = await gateway.load("bugReports");
  return Object.freeze({ bugReportsEnabled: enabled, submitBugReport: module.submitSupabaseBugReport,
    listBugReports: module.listSupabaseBugReports, updateBugReportStatus: module.updateSupabaseBugReportStatus,
    deleteBugReport: module.deleteSupabaseBugReport } satisfies AsyncFunctions<typeof BugReports> & Pick<typeof BugReports, "bugReportsEnabled">);
}
export async function loadSupabaseClaimScreenPort(gateway: Gateway) {
  const module = await gateway.load("claims");
  return Object.freeze({ claimsEnabled: enabled, createClaim: module.createSupabaseClaim, getMyClaimForRestaurant: module.getMySupabaseClaimForRestaurant,
    listClaims: module.listSupabaseClaims, approveClaim: module.approveSupabaseClaim, rejectClaim: module.rejectSupabaseClaim,
    countPendingClaims: module.countSupabasePendingClaims } satisfies AsyncFunctions<typeof Claims> & Pick<typeof Claims, "claimsEnabled">);
}
export async function loadSupabaseOwnerMenuScreenPort(gateway: Gateway) {
  const module = await gateway.load("menus");
  // ensureOwnerMenuDoc was a legacy claims-internal permission helper. Claim
  // approval now seeds/grants the menu atomically on the server, preserving it.
  return Object.freeze({ restaurantMenusEnabled: enabled, getOwnerMenu: module.getSupabaseOwnerMenu,
    updateMyRestaurantMenu: module.updateMySupabaseRestaurantMenu
  } satisfies AsyncFunctions<Omit<typeof Menus, "ensureOwnerMenuDoc">> & Pick<typeof Menus, "restaurantMenusEnabled">);
}
export async function loadSupabaseOwnerReplyScreenPort(gateway: Gateway) {
  const module = await gateway.load("ownerReplies");
  return Object.freeze({ responsesEnabled: enabled, getOwnerResponse: module.getSupabaseOwnerResponse,
    getOwnerResponsesForReviews: module.getSupabaseOwnerResponsesForReviews, createResponse: module.createSupabaseResponse,
    updateResponse: module.updateSupabaseResponse, deleteResponse: module.deleteSupabaseResponse
  } satisfies AsyncFunctions<typeof Replies> & Pick<typeof Replies, "responsesEnabled">);
}
export async function loadSupabaseRestaurantViewScreenPort(gateway: Gateway) {
  const module = await gateway.load("restaurantViews");
  return Object.freeze({ recordRestaurantView: module.recordSupabaseRestaurantView, getRestaurantViewCount: module.getSupabaseRestaurantViewCount } satisfies AsyncFunctions<typeof Views>);
}
export async function loadSupabaseSpotlightScreenPort(gateway: Gateway) {
  const module = await gateway.load("spotlight");
  return Object.freeze({ getSpotConfig: module.getSupabaseSpotConfig, setSpotOfTheDay: module.setSupabaseSpotOfTheDay,
    resolveSpotOfTheDay: module.resolveSupabaseSpotOfTheDay } satisfies AsyncFunctions<typeof Spotlight>);
}
export async function loadSupabaseRemoteConfigScreenPort(gateway: Gateway) {
  const module = await gateway.load("remoteConfig");
  return Object.freeze({ fetchAppGate: module.fetchSupabaseAppGate, compareVersions: module.compareSupabaseVersions } satisfies AsyncFunctions<typeof RemoteConfig> & Pick<typeof RemoteConfig, "compareVersions">);
}
export async function loadSupabaseDeletionScreenPort(gateway: Gateway) {
  const module = await gateway.load("accountDeletion");
  return Object.freeze({ deleteMyAccount: module.deleteMySupabaseAccount } satisfies AsyncFunctions<typeof Deletion>);
}
export async function loadSupabaseRestaurantScreenPort(gateway: Gateway) {
  const [read, admin] = await Promise.all([gateway.load("restaurants"), gateway.load("restaurantAdmin")]);
  return Object.freeze({ parseMenu, serializeMenu, listRestaurants: read.listSupabaseRestaurants, searchRestaurants: read.searchSupabaseRestaurants,
    getRestaurantById: read.getSupabaseRestaurantById, getRestaurantBySlug: read.getSupabaseRestaurantBySlug,
    getRestaurantsByIds: read.getSupabaseRestaurantsByIds, createRestaurant: read.createSupabaseRestaurant,
    adminCreateRestaurant: admin.adminCreateSupabaseRestaurant, bulkImportRestaurants: admin.bulkImportSupabaseRestaurants,
    listAdminRestaurants: admin.listAdminSupabaseRestaurants, updateRestaurant: admin.updateSupabaseRestaurant,
    setRestaurantFlags: admin.setSupabaseRestaurantFlags, approveRestaurant: admin.approveSupabaseRestaurantSubmission,
    deleteRestaurant: admin.deleteSupabaseRestaurant, setRestaurantOwner: admin.setSupabaseRestaurantOwner,
    rebuildSearchText: admin.rebuildSupabaseRestaurantSearch, listClaimedRestaurants: admin.listClaimedSupabaseRestaurants,
    getOwnedRestaurants: admin.getOwnedSupabaseRestaurants
  } satisfies Omit<typeof Restaurants, "RestaurantError" | "setRestaurantListingPaidUntil">);
}

// Exported only as a type for future facade signatures; no legacy runtime load.
export type SupabaseScreenSavedListType = Saved.ListType;
