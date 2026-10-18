import * as ports from "@/services/supabaseScreenPorts";
import type { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
import { currentSupabaseSessionIdentity } from "@/services/supabasePinnedSession";
jest.mock("@/services/supabase", () => { throw new Error("No SDK initialization in port-contract tests"); });
jest.mock("@/services/supabasePinnedSession", () => ({ currentSupabaseSessionIdentity: jest.fn() }));
type Gateway = ReturnType<typeof createSupabaseTestBackend>;
type Factory = (gateway: Gateway) => Promise<object>;
const modules = new Map<string, Record<string, jest.Mock>>();
function moduleFor(domain: string) {
  if (!modules.has(domain)) modules.set(domain, new Proxy({} as Record<string, jest.Mock>, {
    get(target, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      return target[property] ?? (target[property] = jest.fn());
    },
  }));
  return modules.get(domain)!;
}
const load = jest.fn(async (domain: string) => moduleFor(domain));
const gateway = { load } as unknown as Gateway;
beforeEach(() => { jest.resetAllMocks(); modules.clear(); load.mockImplementation(async domain => moduleFor(domain)); });

const aliases: [string, Factory, string, Record<string, string>][] = [
  ["saves", ports.loadSupabaseSavedScreenPort, "saved", { getSavedStatus: "getSupabaseScreenSavedStatus", toggleSaved: "toggleSupabaseScreenSaved", listSavedByUser: "listSupabaseScreenSavedByUser", listSavedRestaurants: "listSupabaseScreenSavedRestaurants" }],
  ["follows", ports.loadSupabaseFollowScreenPort, "relationships", { followUser: "followSupabaseUser", unfollowUser: "unfollowSupabaseUser", isFollowing: "isSupabaseFollowing", getFollowingIds: "getSupabaseFollowingIds", getFollowerIds: "getSupabaseFollowerIds", getFollowCounts: "getSupabaseFollowCounts", listFollowers: "listSupabaseFollowers", listFollowing: "listSupabaseFollowing", getFollowingSetForUsers: "getSupabaseFollowingSetForUsers" }],
  ["blocks", ports.loadSupabaseBlockScreenPort, "relationships", { getHiddenUserIds: "getSupabaseHiddenUserIds", isBlocked: "isSupabaseBlocked" }],
  ["collections", ports.loadSupabaseCollectionScreenPort, "collections", { getList: "getSupabaseCollection", createList: "createSupabaseCollection", updateList: "updateSupabaseCollection", deleteList: "deleteSupabaseCollection", getListWithRestaurants: "getSupabaseCollectionWithRestaurants" }],
  ["posts", ports.loadSupabasePostScreenPort, "posts", { createPost: "createSupabasePost", getPostById: "getSupabasePostById", deletePost: "deleteSupabasePost", listLatestPosts: "listSupabaseLatestPosts", listPostsByFollowing: "listSupabasePostsByFollowing" }],
  ["review likes", ports.loadSupabaseReviewLikeScreenPort, "social", { likeReview: "likeSupabaseReview", unlikeReview: "unlikeSupabaseReview", hasUserLiked: "hasSupabaseUserLikedReview", getLikedReviewIds: "getSupabaseLikedReviewIds" }],
  ["review comments", ports.loadSupabaseReviewCommentScreenPort, "social", { listCommentsForReview: "listSupabaseComments", getCommentById: "getSupabaseCommentById", addComment: "addSupabaseReviewComment", deleteComment: "deleteSupabaseComment" }],
  ["post likes", ports.loadSupabasePostLikeScreenPort, "social", { likePost: "likeSupabasePost", unlikePost: "unlikeSupabasePost", hasUserLikedPost: "hasSupabaseUserLikedPost", getPostLikeCount: "getSupabasePostLikeCount", getLikedPostIds: "getSupabaseLikedPostIds", getPostLikeCounts: "getSupabasePostLikeCounts" }],
  ["post comments", ports.loadSupabasePostCommentScreenPort, "social", { listCommentsForPost: "listSupabaseCommentsForPost", getPostCommentById: "getSupabasePostCommentById", addPostComment: "addSupabasePostComment", deletePostComment: "deleteSupabasePostComment", getPostCommentCounts: "getSupabasePostCommentCounts" }],
  ["inbox", ports.loadSupabaseNotificationScreenPort, "notifications", { listMyNotifications: "listSupabaseNotifications", getUnreadCount: "getSupabaseUnreadCount", markRead: "markSupabaseNotificationRead", markAllRead: "markAllSupabaseNotificationsRead", deleteNotification: "deleteSupabaseNotification" }],
  ["prefs", ports.loadSupabasePreferenceScreenPort, "preferences", { getUserPreferences: "getSupabaseUserPreferences", updateUserPreferences: "updateSupabaseUserPreferences" }],
  ["reports", ports.loadSupabaseReportScreenPort, "reports", { reportReview: "reportSupabaseReview", reportComment: "reportSupabaseComment", reportPost: "reportSupabasePost", reportPostComment: "reportSupabasePostComment", hasUserReported: "hasSupabaseUserReported", listReports: "listSupabaseReports", deleteReport: "deleteSupabaseReport", listCommentReports: "listSupabaseCommentReports", deleteCommentReport: "deleteSupabaseCommentReport", listPostReports: "listSupabasePostReports", deletePostReport: "deleteSupabasePostReport", listPostCommentReports: "listSupabasePostCommentReports", deletePostCommentReport: "deleteSupabasePostCommentReport" }],
  ["bugs", ports.loadSupabaseBugReportScreenPort, "bugReports", { submitBugReport: "submitSupabaseBugReport", listBugReports: "listSupabaseBugReports", updateBugReportStatus: "updateSupabaseBugReportStatus", deleteBugReport: "deleteSupabaseBugReport" }],
  ["claims", ports.loadSupabaseClaimScreenPort, "claims", { createClaim: "createSupabaseClaim", getMyClaimForRestaurant: "getMySupabaseClaimForRestaurant", listClaims: "listSupabaseClaims", approveClaim: "approveSupabaseClaim", rejectClaim: "rejectSupabaseClaim", countPendingClaims: "countSupabasePendingClaims" }],
  ["owner menus", ports.loadSupabaseOwnerMenuScreenPort, "menus", { getOwnerMenu: "getSupabaseOwnerMenu", updateMyRestaurantMenu: "updateMySupabaseRestaurantMenu" }],
  ["owner replies", ports.loadSupabaseOwnerReplyScreenPort, "ownerReplies", { getOwnerResponse: "getSupabaseOwnerResponse", getOwnerResponsesForReviews: "getSupabaseOwnerResponsesForReviews", createResponse: "createSupabaseResponse", updateResponse: "updateSupabaseResponse", deleteResponse: "deleteSupabaseResponse" }],
  ["views", ports.loadSupabaseRestaurantViewScreenPort, "restaurantViews", { recordRestaurantView: "recordSupabaseRestaurantView", getRestaurantViewCount: "getSupabaseRestaurantViewCount" }],
  ["spotlight", ports.loadSupabaseSpotlightScreenPort, "spotlight", { getSpotConfig: "getSupabaseSpotConfig", setSpotOfTheDay: "setSupabaseSpotOfTheDay", resolveSpotOfTheDay: "resolveSupabaseSpotOfTheDay" }],
  ["remote config", ports.loadSupabaseRemoteConfigScreenPort, "remoteConfig", { fetchAppGate: "fetchSupabaseAppGate", compareVersions: "compareSupabaseVersions" }],
  ["deletion", ports.loadSupabaseDeletionScreenPort, "accountDeletion", { deleteMyAccount: "deleteMySupabaseAccount" }],
  ["badges", ports.loadSupabaseBadgeScreenPort, "badges", { syncEarnedBadges: "syncSupabaseEarnedBadges" }],
];
test.each(aliases)("%s port keeps existing names and correct implementation identities", async (_label, factory, domain, names) => {
  const port = await factory(gateway) as Record<string, unknown>;
  expect(Object.isFrozen(port)).toBe(true);
  for (const [legacy, staged] of Object.entries(names)) expect(port[legacy]).toBe(moduleFor(domain)[staged]);
  expect(load).toHaveBeenCalledWith(domain);
});
test("collections adapt owner/public reads and add/remove without losing results", async () => {
  const port = await ports.loadSupabaseCollectionScreenPort(gateway), module = moduleFor("collections");
  await port.listMyLists(); expect(module.listSupabaseCollections).toHaveBeenLastCalledWith();
  await port.listPublicListsByUser("owner"); expect(module.listSupabaseCollections).toHaveBeenLastCalledWith("owner", true);
  const result = { id: "collection" }; module.changeSupabaseCollectionMembership.mockResolvedValue(result);
  expect(await port.addToList("collection", "restaurant")).toBe(result);
  expect(module.changeSupabaseCollectionMembership).toHaveBeenLastCalledWith("collection", "restaurant", true);
  expect(await port.removeFromList("collection", "restaurant")).toBe(result);
  expect(module.changeSupabaseCollectionMembership).toHaveBeenLastCalledWith("collection", "restaurant", false);
});
test("block management maps only public profiles and keeps block direction distinct from hidden union", async () => {
  const port = await ports.loadSupabaseBlockScreenPort(gateway), module = moduleFor("relationships"), users = moduleFor("users");
  await port.blockUser("target"); expect(module.setSupabaseBlocked).toHaveBeenLastCalledWith("target", true);
  await port.unblockUser("target"); expect(module.setSupabaseBlocked).toHaveBeenLastCalledWith("target", false);
  const profile = { id: "target" }, user = { id: "target", displayName: "Public name" };
  module.listSupabaseBlockedProfiles.mockResolvedValue([profile]); users.mapSupabasePublicProfile.mockReturnValue(user);
  expect(await port.listBlockedUsers()).toEqual([user]); expect(users.mapSupabasePublicProfile.mock.calls[0][0]).toBe(profile);
});
test("liked tabs preserve likedAt Map and paging rather than creation-date sorting", async () => {
  const reviews = await ports.loadSupabaseReviewLikeScreenPort(gateway), posts = await ports.loadSupabasePostLikeScreenPort(gateway);
  const module = moduleFor("likedContent"), page = { items: [], likedAt: new Map(), hasMore: true, nextCursor: "cursor" };
  module.listSupabaseLikedReviewsByUser.mockResolvedValue(page); module.listSupabaseLikedPostsByUser.mockResolvedValue(page);
  const options = { cursor: "cursor", pageSize: 30 };
  expect(await reviews.listLikedReviewsByUser("user", options)).toBe(page);
  expect(await posts.listLikedPostsByUser("user", options)).toBe(page);
  expect(module.listSupabaseLikedPostsByUser).toHaveBeenCalledWith("user", options);
});
test("onboarding uses one atomic preference update and retains badge initialization", async () => {
  const port = await ports.loadSupabasePreferenceScreenPort(gateway), module = moduleFor("preferences");
  module.getSupabaseUserPreferences.mockResolvedValue({ favoriteCuisines: ["seafood"], favoriteParishes: ["kingston"], seenBadgeIds: [] });
  expect(await port.getTastePreferences()).toEqual({ favoriteCuisines: ["seafood"], favoriteParishes: ["kingston"] });
  await port.setOnboardingPending(true); expect(module.updateSupabaseUserPreferences).toHaveBeenLastCalledWith({ onboardingPending: true });
  await port.completeOnboarding({ favoriteCuisines: ["seafood"], favoriteParishes: ["kingston"] });
  expect(module.updateSupabaseUserPreferences).toHaveBeenLastCalledWith({ favoriteCuisines: ["seafood"], favoriteParishes: ["kingston"], onboardingPending: false, seenBadgeIds: [] });
});
test("restaurant port includes free admin/submission/search but no listing-payment write", async () => {
  const port = await ports.loadSupabaseRestaurantScreenPort(gateway);
  expect(Object.keys(port)).toHaveLength(19);
  expect(port.searchRestaurants).toBe(moduleFor("restaurants").searchSupabaseRestaurants);
  expect(port.createRestaurant).toBe(moduleFor("restaurants").createSupabaseRestaurant);
  expect(port.adminCreateRestaurant).toBe(moduleFor("restaurantAdmin").adminCreateSupabaseRestaurant);
  expect(port.approveRestaurant).toBe(moduleFor("restaurantAdmin").approveSupabaseRestaurantSubmission);
  expect(port).not.toHaveProperty("setRestaurantListingPaidUntil");
});
test("inbox and claim ports omit obsolete client-notification/permission mutation helpers", async () => {
  const inbox = await ports.loadSupabaseNotificationScreenPort(gateway), menu = await ports.loadSupabaseOwnerMenuScreenPort(gateway);
  expect(inbox).not.toHaveProperty("hasRecentSimilarNotification"); expect(menu).not.toHaveProperty("ensureOwnerMenuDoc");
  const claim = await ports.loadSupabaseClaimScreenPort(gateway); await claim.approveClaim({ id: "claim" } as Parameters<typeof claim.approveClaim>[0]);
  expect(moduleFor("claims").approveSupabaseClaim).toHaveBeenCalledTimes(1);
  expect(load.mock.calls.map(call => call[0])).toEqual(["notifications", "menus", "claims"]);
});
test("auth port routes every flow to its correct staged module", async () => {
  const port = await ports.loadSupabaseAuthScreenPort(gateway);
  expect(Object.keys(port)).toHaveLength(15);
  expect(port.login).toBe(moduleFor("auth").loginWithSupabase); expect(port.logout).toBe(moduleFor("auth").logoutFromSupabase);
  expect(port.confirmEmailVerified).toBe(moduleFor("auth").confirmSupabaseEmailVerified);
  expect(port.verifyEmailOtp).toBe(moduleFor("emailAuth").verifySupabaseEmailOtp);
  expect(port.resetPassword).toBe(moduleFor("emailAuth").resetSupabasePassword);
  expect(port.loginWithGoogle).toBe(moduleFor("oauth").loginWithSupabaseGoogle);
  expect(port.completeOAuthSignup).toBe(moduleFor("oauth").completeSupabaseOAuthSignup);
  expect(port.emailVerificationEnabled()).toBe(true); expect(port.passwordResetEnabled()).toBe(true);
});
test("device-token cleanup honors the supplied account and captures identity before awaiting", async () => {
  const port = await ports.loadSupabasePushScreenPort(gateway), push = moduleFor("pushTokens");
  const identity = { userId: "account-a", accessToken: "test-a-token" };
  (currentSupabaseSessionIdentity as jest.Mock).mockResolvedValue(identity);
  await port.clearPushTokensForUser("account-b"); expect(push.clearCurrentSupabasePushToken).not.toHaveBeenCalled();
  push.clearCurrentSupabasePushToken.mockResolvedValue(undefined);
  await port.clearPushTokensForUser("account-a"); expect(push.clearCurrentSupabasePushToken).toHaveBeenCalledWith(identity);
  await port.registerForPushNotifications("account-a"); expect(push.registerForSupabasePushNotifications).toHaveBeenCalledWith("account-a");
});
