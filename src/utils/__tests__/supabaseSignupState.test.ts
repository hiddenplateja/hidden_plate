import { hasPendingSupabaseSignup } from "@/utils/supabaseSignupState";

test.each([{ user_id: "user-a" }, [{ user_id: "user-a" }]].map(value => [value]))("recognizes pending row %j", value => {
  expect(hasPendingSupabaseSignup(value, "user-a")).toBe(true);
});
test.each([null, []].map(value => [value]))("recognizes completed signup %j", value => {
  expect(hasPendingSupabaseSignup(value, "user-a")).toBe(false);
});
test.each([undefined, {}, false, "pending", { user_id: "user-b" }, [null], [{ user_id: "user-a" }, { user_id: "user-a" }]].map(value => [value]))("rejects ambiguous/mismatched status %j", value => {
  expect(() => hasPendingSupabaseSignup(value, "user-a")).toThrow("signup status");
});
