import { AppState } from "react-native";
import { supabase } from "@/services/supabase";
import { acquireSupabaseSessionRefresh } from "@/services/supabaseSessionLifecycle";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock("@/services/supabase", () => ({ supabase: { auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } } }));

test("one lifecycle listener is shared, background pauses, and last consumer cleans up", () => {
  const first = acquireSupabaseSessionRefresh();
  const second = acquireSupabaseSessionRefresh();
  const add = AppState.addEventListener as jest.Mock;
  expect(add).toHaveBeenCalledTimes(1);
  expect(supabase.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  const onChange = add.mock.calls[0][1];
  onChange("background"); expect(supabase.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  onChange("active"); expect(supabase.auth.startAutoRefresh).toHaveBeenCalledTimes(2);
  first(); first();
  expect(add.mock.results[0].value.remove).not.toHaveBeenCalled();
  second();
  expect(add.mock.results[0].value.remove).toHaveBeenCalledTimes(1);
  expect(supabase.auth.stopAutoRefresh).toHaveBeenCalledTimes(2);
});
