import { createSupabaseTestBackend } from "@/services/supabaseTestBackend";
import { loadSupabaseAdminScreenPort, loadSupabaseRestaurantReadPort, loadSupabaseReviewScreenPort, loadSupabaseUserScreenPort } from "@/services/supabaseScreenPorts";

jest.mock("@/services/supabaseRestaurants", () => ({ listSupabaseRestaurants: jest.fn(), getSupabaseRestaurantById: jest.fn(),
  getSupabaseRestaurantBySlug: jest.fn(), getSupabaseRestaurantsByIds: jest.fn() }));
jest.mock("@/services/supabaseReviews", () => ({ listSupabaseReviewsForRestaurant: jest.fn(), listSupabaseReviewsByUser: jest.fn(),
  getSupabaseReviewById: jest.fn(), getSupabaseRestaurantReviewStats: jest.fn(), getSupabaseRestaurantRatingDistribution: jest.fn(),
  getSupabaseReviewStatsForRestaurants: jest.fn(), createSupabaseReview: jest.fn(), updateSupabaseReview: jest.fn(), deleteSupabaseReview: jest.fn(),
  getMySupabaseReviewForRestaurant: jest.fn(), getSupabaseUserReviewStats: jest.fn(), listSupabaseReviewsByFollowing: jest.fn(), listSupabaseLatestReviews: jest.fn() }));
jest.mock("@/services/supabaseUsers", () => ({ getSupabaseUsersByIds: jest.fn(), getSupabaseUserById: jest.fn(), listSupabaseUsers: jest.fn(),
  setSupabaseUserBanned: jest.fn(), updateMySupabaseProfile: jest.fn(), searchSupabaseUsers: jest.fn(), getSupabaseSuggestedUsers: jest.fn() }));
jest.mock("@/services/supabaseAdmin", () => ({ checkSupabaseIsAdmin: jest.fn(), getSupabaseAdminStats: jest.fn() }));
jest.mock("@/services/appwrite", () => { throw new Error("Legacy type imports must not initialize Appwrite"); });
jest.mock("@/services/supabase", () => { throw new Error("No real Supabase requests in port contract tests"); });

let original: NodeJS.ProcessEnv;
beforeEach(() => {
  original = { ...process.env };
  process.env.EXPO_PUBLIC_BACKEND = "supabase";
  process.env.EXPO_PUBLIC_BACKEND_TEST_MODE = "true";
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = "https://media.example.test";
});
afterEach(() => { process.env = original; });

test("restaurant-read port retains argument, result, and Map identities", async () => {
  const gateway = createSupabaseTestBackend("preview");
  const module = await gateway.load("restaurants"); const port = await loadSupabaseRestaurantReadPort(gateway);
  const options = { pageSize: 2000, sort: "rating" as const };
  const page = { items: [], total: 0, hasMore: false, nextCursor: null };
  (module.listSupabaseRestaurants as jest.Mock).mockResolvedValue(page);
  expect(await port.listRestaurants(options)).toBe(page);
  expect(module.listSupabaseRestaurants).toHaveBeenCalledWith(options);
  const map = new Map(); (module.getSupabaseRestaurantsByIds as jest.Mock).mockResolvedValue(map);
  expect(await port.getRestaurantsByIds(["restaurant-id"])).toBe(map);
});
test("review ratings and feeds use the staged implementation without reshaping results", async () => {
  const gateway = createSupabaseTestBackend("preview");
  const module = await gateway.load("reviews"); const port = await loadSupabaseReviewScreenPort(gateway);
  expect(Object.keys(port)).toHaveLength(13);
  const ratings = new Map([["restaurant-id", { count: 5, average: 4.2 }]]);
  (module.getSupabaseReviewStatsForRestaurants as jest.Mock).mockResolvedValue(ratings);
  expect(await port.getReviewStatsForRestaurants(["restaurant-id"])).toBe(ratings);
  expect(port.listReviewsByFollowing).toBe(module.listSupabaseReviewsByFollowing);
  expect(port.updateReview).toBe(module.updateSupabaseReview);
});
test("user/admin ports retain original function names and propagate errors", async () => {
  const gateway = createSupabaseTestBackend("preview");
  const users = await gateway.load("users"); const userPort = await loadSupabaseUserScreenPort(gateway);
  expect(Object.keys(userPort)).toHaveLength(10);
  expect(userPort.updateMyProfile).toBe(users.updateMySupabaseProfile);
  const admin = await gateway.load("admin"); const adminPort = await loadSupabaseAdminScreenPort(gateway);
  (admin.checkSupabaseIsAdmin as jest.Mock).mockResolvedValue(false);
  expect(await adminPort.checkIsAdmin()).toBe(false);
  const error = new Error("permission denied"); (admin.getSupabaseAdminStats as jest.Mock).mockRejectedValue(error);
  await expect(adminPort.getAdminStats()).rejects.toBe(error);
});
