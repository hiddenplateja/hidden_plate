import { syncSupabaseEarnedBadges } from "@/services/supabaseBadges";
import { currentSupabaseSessionIdentity, pinSupabaseSession } from "@/services/supabasePinnedSession";
import { getReviewerBadges } from "@/utils/reviewerBadges";
jest.mock("@/services/supabase", () => ({ supabase: {} }));
jest.mock("@/services/supabasePinnedSession", () => ({ currentSupabaseSessionIdentity: jest.fn(), pinSupabaseSession: jest.fn() }));
jest.mock("@/utils/reviewerBadges", () => ({ getReviewerBadges: jest.fn() }));
const identity = { userId: "account-a", accessToken: "test-account-a-token" };
const current = currentSupabaseSessionIdentity as jest.Mock, pin = pinSupabaseSession as jest.Mock;
const stats = { reviewCount: 10, parishesVisited: 3 };
const earned = [{ id: "badge-a" }, { id: "badge-b" }];
let seen: string[] | null, single: jest.Mock, rpc: jest.Mock, header: jest.Mock, readError: { message: string } | null;
beforeEach(() => {
  jest.resetAllMocks(); seen = []; readError = null; header = jest.fn();
  current.mockResolvedValue(identity); (getReviewerBadges as jest.Mock).mockReturnValue(earned);
  single = jest.fn(async () => ({ data: { preferences: { seenBadgeIds: seen } }, error: readError }));
  const query = { select: jest.fn(), eq: jest.fn(), setHeader: jest.fn(), abortSignal: jest.fn(), single };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.abortSignal.mockReturnValue(query);
  query.setHeader.mockImplementation((...args) => { header(...args); return query; });
  rpc = jest.fn((_name, args) => ({ setHeader: (name: string, value: string) => {
    header(name, value); return { abortSignal: async () => { seen = args.preference_patch.seenBadgeIds; return { error: null }; } };
  } }));
  pin.mockResolvedValue({ ...identity, client: { from: jest.fn(() => query), rpc } });
});

test("new accounts celebrate new earned badges and persist them with pinned credentials", async () => {
  expect(await syncSupabaseEarnedBadges(stats)).toEqual(earned);
  expect(getReviewerBadges).toHaveBeenCalledWith(stats);
  expect(rpc).toHaveBeenCalledWith("merge_my_preferences", { preference_patch: { seenBadgeIds: ["badge-a", "badge-b"] } });
  expect(header.mock.calls.every(call => call[0] === "Authorization" && call[1] === `Bearer ${identity.accessToken}`)).toBe(true);
  expect(pin).toHaveBeenCalledWith(identity);
});
test("null legacy baseline is initialized silently without retroactive celebrations", async () => {
  seen = null; expect(await syncSupabaseEarnedBadges(stats)).toEqual([]); expect(seen).toEqual(["badge-a", "badge-b"]);
});
test("previously seen badges are retained in the union and only new badges celebrate", async () => {
  seen = ["old-badge", "badge-a"];
  expect(await syncSupabaseEarnedBadges(stats)).toEqual([{ id: "badge-b" }]);
  expect(seen).toEqual(["old-badge", "badge-a", "badge-b"]);
});
test("already-seen badges do not write or celebrate again", async () => {
  seen = ["badge-a", "badge-b"]; expect(await syncSupabaseEarnedBadges(stats)).toEqual([]); expect(rpc).not.toHaveBeenCalled();
});
test("missing or revoked sessions never read or write preferences", async () => {
  current.mockResolvedValue(null); expect(await syncSupabaseEarnedBadges(stats)).toEqual([]); expect(single).not.toHaveBeenCalled();
  current.mockResolvedValue(identity); pin.mockResolvedValue(null); expect(await syncSupabaseEarnedBadges(stats)).toEqual([]);
  expect(single).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
test("private preference failures return no celebration instead of treating the account as new", async () => {
  readError = { message: "offline" }; expect(await syncSupabaseEarnedBadges(stats)).toEqual([]); expect(rpc).not.toHaveBeenCalled();
});
test("account switch before writing discards the old account's pending badge sync", async () => {
  current.mockResolvedValueOnce(identity).mockResolvedValueOnce({ userId: "account-b", accessToken: "test-b-token" });
  expect(await syncSupabaseEarnedBadges(stats)).toEqual([]); expect(rpc).not.toHaveBeenCalled();
});
test("write failure cannot show a celebration as persisted", async () => {
  rpc.mockReturnValue({ setHeader: () => ({ abortSignal: async () => ({ error: { message: "denied" } }) }) });
  expect(await syncSupabaseEarnedBadges(stats)).toEqual([]);
});
test("post-write account replacement cannot publish the previous account's badge result", async () => {
  current.mockResolvedValueOnce(identity).mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...identity, accessToken: "replacement" });
  expect(await syncSupabaseEarnedBadges(stats)).toEqual([]); expect(rpc).toHaveBeenCalledTimes(1);
});
test("concurrent syncs serialize and only the first returns a new celebration", async () => {
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  single.mockImplementationOnce(async () => { started(); await blocked; return { data: { preferences: { seenBadgeIds: seen } }, error: null }; });
  const first = syncSupabaseEarnedBadges(stats); await entered;
  const second = syncSupabaseEarnedBadges(stats); release();
  expect(await first).toEqual(earned); expect(await second).toEqual([]); expect(rpc).toHaveBeenCalledTimes(1);
});
