import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLastOAuth, setLastOAuth, clearLastOAuth } from "@/services/lastOAuth";
import { getRuntimeBackend, getRuntimeCacheNamespace } from "@/services/backendRuntime";
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule:true,default:{getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()} }));
jest.mock("@/services/backendRuntime", () => ({getRuntimeBackend:jest.fn(),getRuntimeCacheNamespace:jest.fn()}));
const identity = {provider:"google" as const,name:"Test",email:"test@example.test",photoUrl:null};
beforeEach(() => { jest.resetAllMocks(); (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(identity)); });
test("Appwrite keeps the existing last-account shortcut key", async () => {
  (getRuntimeBackend as jest.Mock).mockReturnValue("appwrite");
  expect(await getLastOAuth()).toEqual(identity); await setLastOAuth(identity); await clearLastOAuth();
  expect(AsyncStorage.getItem).toHaveBeenCalledWith("@hp_last_oauth");
  expect(AsyncStorage.setItem).toHaveBeenCalledWith("@hp_last_oauth",JSON.stringify(identity));
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith("@hp_last_oauth");
});
test("Supabase shortcut data stays isolated by backend/project without tokens", async () => {
  (getRuntimeBackend as jest.Mock).mockReturnValue("supabase"); (getRuntimeCacheNamespace as jest.Mock).mockReturnValue("supabase:project-a");
  expect(await getLastOAuth()).toEqual(identity); await setLastOAuth(identity);
  expect(AsyncStorage.getItem).toHaveBeenCalledWith("supabase:project-a:last-oauth");
  (getRuntimeCacheNamespace as jest.Mock).mockReturnValue("supabase:project-b"); await clearLastOAuth();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith("supabase:project-b:last-oauth");
});
