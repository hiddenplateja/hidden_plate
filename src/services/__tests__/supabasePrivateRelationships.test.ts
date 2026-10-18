import { supabase } from "@/services/supabase";
import { setSupabaseSaved, setSupabaseBlocked } from "@/services/supabaseRelationships";
import { createSupabaseCollection, updateSupabaseCollection, deleteSupabaseCollection,
  changeSupabaseCollectionMembership, getSupabaseCollectionWithRestaurants } from "@/services/supabaseCollections";
import { getSupabaseRestaurantsByIds } from "@/services/supabaseRestaurants";
import { getSupabaseReviewStatsForRestaurants } from "@/services/supabaseReviews";

jest.mock("@/services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock("@/services/supabaseDataRequest", () => jest.requireActual("./fixtures/supabaseDataContractMock").supabaseDataContractMock(supabase));
jest.mock("@/services/supabaseRestaurants", () => ({ getSupabaseRestaurantsByIds: jest.fn() }));
jest.mock("@/services/supabaseReviews", () => ({ getSupabaseReviewStatsForRestaurants: jest.fn() }));
const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const auth = supabase.auth.getUser as jest.Mock;
const id = "fc220000-0000-4000-8000-000000000001";
const other = "fc220000-0000-4000-8000-000000000002";
const row = { id, owner_id: other, title: "Dinner", description: null, is_public: true,
  restaurant_ids: [other], cover_restaurant_id: other, created_at: "created", updated_at: "updated" };
beforeEach(() => { jest.resetAllMocks(); rpc.mockResolvedValue({ data: id }); });

test.each(["favorite", "want_to_go", "visited"] as const)("save %s uses only server-derived identity", async type => {
  await setSupabaseSaved(id, type, true);
  expect(rpc).toHaveBeenCalledWith("set_member_saved", { target_restaurant: id, saved_list: type, should_save: true });
  expect(from).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled();
});
test("unsaving is explicit and checked", async () => {
  await setSupabaseSaved(id, "visited", false);
  expect(rpc.mock.calls[0][1].should_save).toBe(false);
  rpc.mockResolvedValue({ data: other });
  await expect(setSupabaseSaved(id, "favorite", true)).rejects.toThrow("Couldn't update");
});
test("invalid saves never reach the database", async () => {
  await expect(setSupabaseSaved("bad", "favorite", true)).rejects.toThrow("Invalid");
  await expect(setSupabaseSaved(id, "saved" as never, true)).rejects.toThrow("Invalid");
  await expect(setSupabaseSaved(id, "favorite", null as never)).rejects.toThrow("Invalid");
  expect(rpc).not.toHaveBeenCalled();
});
test("block/unblock use target only and surface server checks", async () => {
  await setSupabaseBlocked(id, true); await setSupabaseBlocked(id, false);
  expect(rpc.mock.calls).toEqual([["set_member_block", { target_user: id, should_block: true }],
    ["set_member_block", { target_user: id, should_block: false }]]);
  expect(from).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: { message: "Invalid block." } });
  await expect(setSupabaseBlocked(id, true)).rejects.toThrow("Invalid block");
});
test("invalid block arguments and malformed confirmation fail", async () => {
  await expect(setSupabaseBlocked("bad", true)).rejects.toThrow("Invalid");
  await expect(setSupabaseBlocked(id, "true" as never)).rejects.toThrow("Invalid");
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: null }); await expect(setSupabaseBlocked(id, false)).rejects.toThrow("Couldn't update");
});
test("collection creation trims fields without trusting extra owner/membership input", async () => {
  rpc.mockResolvedValue({ data: row });
  const result = await createSupabaseCollection({ title: " Dinner ", description: " ", isPublic: true,
    owner_id: id, restaurant_ids: [id] } as never);
  expect(rpc).toHaveBeenCalledWith("write_member_collection", { target_collection: null,
    collection_patch: { title: "Dinner", description: null, is_public: true } });
  expect(result).toEqual({ id, ownerId: other, title: "Dinner", description: null, isPublic: true,
    restaurantIds: [other], coverRestaurantId: other, createdAt: "created", updatedAt: "updated" });
  expect(from).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled();
});
test("collection patches preserve omitted fields and clear explicit descriptions", async () => {
  rpc.mockResolvedValue({ data: [row] });
  await updateSupabaseCollection(id, { description: null, isPublic: false, owner_id: other } as never);
  expect(rpc).toHaveBeenLastCalledWith("write_member_collection", { target_collection: id,
    collection_patch: { description: null, is_public: false } });
  await updateSupabaseCollection(id, { title: " Lunch " });
  expect(rpc.mock.calls.at(-1)[1].collection_patch).toEqual({ title: "Lunch" });
});
test("delete checks confirmation and membership preserves array order/cover", async () => {
  await deleteSupabaseCollection(id);
  expect(rpc).toHaveBeenCalledWith("delete_member_collection", { target_collection: id });
  rpc.mockResolvedValue({ data: row });
  expect(await changeSupabaseCollectionMembership(id, other, false)).toMatchObject({ restaurantIds: [other], coverRestaurantId: other });
  expect(rpc).toHaveBeenLastCalledWith("change_collection_membership", { collection_id: id, restaurant_id: other, should_add: false });
});
test("collection invalid IDs, empty titles and membership arguments fail early", async () => {
  await expect(createSupabaseCollection({ title: " " })).rejects.toThrow("Enter");
  await expect(updateSupabaseCollection("bad", {})).rejects.toThrow("Invalid");
  await expect(updateSupabaseCollection(id, { title: " " })).rejects.toThrow("Enter");
  await expect(deleteSupabaseCollection("bad")).rejects.toThrow("Invalid");
  await expect(changeSupabaseCollectionMembership(id, "bad", true)).rejects.toThrow("Invalid");
  await expect(changeSupabaseCollectionMembership(id, other, null as never)).rejects.toThrow("Invalid");
  expect(rpc).not.toHaveBeenCalled();
});
test("write failures and malformed collection success are not swallowed", async () => {
  rpc.mockResolvedValue({ error: { message: "Permission denied" } });
  await expect(createSupabaseCollection({ title: "Dinner" })).rejects.toThrow("Permission denied");
  await expect(setSupabaseSaved(id, "favorite", true)).rejects.toThrow("Permission denied");
  await expect(deleteSupabaseCollection(id)).rejects.toThrow("Permission denied");
  rpc.mockResolvedValue({ data: null }); await expect(updateSupabaseCollection(id, {})).rejects.toThrow("Couldn't load");
  rpc.mockResolvedValue({ data: other }); await expect(deleteSupabaseCollection(id)).rejects.toThrow("Couldn't delete");
  rpc.mockRejectedValue(new Error("Offline")); await expect(setSupabaseBlocked(id, true)).rejects.toThrow("Offline");
});
test("public collection hydration retains real ratings", async () => {
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: row }) };
  from.mockReturnValue(query);
  (getSupabaseRestaurantsByIds as jest.Mock).mockResolvedValue(new Map([[other, { id: other, name: "Restaurant" }]]));
  (getSupabaseReviewStatsForRestaurants as jest.Mock).mockResolvedValue(new Map([[other, { count: 12, average: 4.7 }]]));
  expect((await getSupabaseCollectionWithRestaurants(id)).restaurants[0]).toMatchObject({ id: other, reviewCount: 12, averageRating: 4.7 });
});
