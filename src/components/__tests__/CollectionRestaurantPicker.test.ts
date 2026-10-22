import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import * as Location from "expo-location";
import AddRestaurantsScreen from "../../../app/list/add/[id]";
import { useAuth } from "@/hooks/useAuth";
import { getList } from "@/services/lists";
import { addCollectionSelections, loadCollectionSuggestions, searchCollectionRestaurants } from "@/services/collectionPicker";
import { makeRestaurant } from "@/utils/__tests__/fixtures";

jest.mock("react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return { ...Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Pressable", "Text", "TextInput", "View"].map(name => [name, name])),
    Platform: { OS: "android" }, Alert: { alert: jest.fn() }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    FlatList: (props: any) => React.createElement("FlatList", props,
      props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: item.restaurant.id }, props.renderItem({ item, index }))),
      props.data.length ? null : props.ListEmptyComponent, props.ListFooterComponent),
  };
});
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("lucide-react-native", () => Object.fromEntries(["ArrowLeft", "Check", "Circle", "Search", "UtensilsCrossed", "X"].map(name => [name, name])));
jest.mock("expo-router", () => ({ useRouter: () => router, useLocalSearchParams: () => ({ id: "collection" }) }));
jest.mock("expo-location", () => ({ getForegroundPermissionsAsync: jest.fn(), getLastKnownPositionAsync: jest.fn() }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/services/lists", () => ({ getList: jest.fn() }));
jest.mock("@/services/storage", () => ({ getImagePreviewUrl: (id: string) => `image://${id}` }));
jest.mock("@/services/collectionPicker", () => ({ addCollectionSelections: jest.fn(), loadCollectionSuggestions: jest.fn(), searchCollectionRestaurants: jest.fn() }));
jest.mock("@/theme/useThemedStyles", () => ({ useThemedStyles: (factory: any) => {
  const { colors } = jest.requireActual("@/theme/colors"); return { colors, styles: factory(colors) };
} }));

const router = { back: jest.fn() };
const suggestions = Array.from({ length: 45 }, (_, i) => ({ restaurant: makeRestaurant({ id: `r${i}`, name: `Restaurant ${i}` }), reason: "In your favorites" }));
let renderer: ReactTestRenderer | undefined, consoleError: jest.SpyInstance;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const choices = () => renderer!.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityRole === "checkbox");
const button = (text: string) => renderer!.root.findAll(node => String(node.type) === "Pressable").find(node =>
  node.findAll(child => String(child.type) === "Text").some(child => String(child.props.children).includes(text)))!;
async function mount(strict = false) { await act(async () => { renderer = create(strict ? React.createElement(React.StrictMode, null, React.createElement(AddRestaurantsScreen)) : React.createElement(AddRestaurantsScreen)); }); }
async function search(text: string) {
  await act(async () => { renderer!.root.find(node => String(node.type) === "TextInput").props.onChangeText(text); });
  await act(async () => { jest.advanceTimersByTime(300); });
}
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  const original = console.error;
  consoleError = jest.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated.")) original(...args); });
  (useAuth as jest.Mock).mockReturnValue({ user: { id: "owner" } });
  (getList as jest.Mock).mockResolvedValue({ id: "collection", ownerId: "owner", title: "My collection", restaurantIds: ["existing"] });
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
  (loadCollectionSuggestions as jest.Mock).mockResolvedValue({ items: suggestions, limitedPersonalization: false });
  (searchCollectionRestaurants as jest.Mock).mockResolvedValue({ items: [makeRestaurant({ id: "search-result" })], hasMore: false, nextCursor: null });
  (addCollectionSelections as jest.Mock).mockResolvedValue({ addedIds: ["r0", "search-result"], failedIds: [] });
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; jest.useRealTimers(); consoleError.mockRestore(); });

test("opens with 20 suggestions, loads 20 more on demand, and does not request location", async () => {
  await mount(); expect(choices()).toHaveLength(20);
  await act(async () => { button("Show 20 more").props.onPress(); }); expect(choices()).toHaveLength(40);
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  expect(loadCollectionSuggestions).toHaveBeenCalledWith("owner", ["existing"], null);
});
test("multiple selections survive search and are submitted together", async () => {
  await mount(); await act(async () => { choices()[0].props.onPress(); });
  await search("pizza"); expect(searchCollectionRestaurants).toHaveBeenCalledWith("pizza", ["existing"]);
  await act(async () => { choices()[0].props.onPress(); });
  await search(""); expect(choices()[0].props.accessibilityState.checked).toBe(true);
  await act(async () => { button("Add selected").props.onPress(); });
  expect(addCollectionSelections).toHaveBeenCalledWith("collection", "owner", ["r0", "search-result"]);
  expect(router.back).toHaveBeenCalledTimes(1);
});
test("partial failures retain only failed selections for retry", async () => {
  (addCollectionSelections as jest.Mock).mockResolvedValue({ addedIds: ["r0"], failedIds: ["r1"] });
  await mount(); await act(async () => { choices()[0].props.onPress(); choices()[1].props.onPress(); });
  await act(async () => { button("Add selected").props.onPress(); });
  expect(choices().some(choice => choice.props.accessibilityLabel.startsWith("Restaurant 0."))).toBe(false);
  expect(choices().filter(choice => choice.props.accessibilityState.checked)).toHaveLength(1);
  expect(Alert.alert).toHaveBeenCalledWith("Some restaurants weren't added", expect.stringContaining("1 still selected"));
  expect(router.back).not.toHaveBeenCalled();
});
test("non-owners never load private suggestions or see selection controls", async () => {
  (getList as jest.Mock).mockResolvedValue({ ownerId: "other" });
  await mount(); expect(loadCollectionSuggestions).not.toHaveBeenCalled(); expect(choices()).toHaveLength(0);
});
test("account switching discards selections and reloads scoped suggestions", async () => {
  await mount(); await act(async () => { choices()[0].props.onPress(); });
  (useAuth as jest.Mock).mockReturnValue({ user: { id: "owner-2" } });
  (getList as jest.Mock).mockResolvedValue({ ownerId: "owner-2", restaurantIds: [] });
  await act(async () => { renderer!.update(React.createElement(AddRestaurantsScreen)); });
  expect(choices().every(choice => !choice.props.accessibilityState.checked)).toBe(true);
  expect(loadCollectionSuggestions).toHaveBeenLastCalledWith("owner-2", [], null);
});
test("strict mode still accepts async search results", async () => {
  await mount(true); await search("jerk"); expect(choices()).toHaveLength(1);
});
test("late results from an old search cannot replace the current query", async () => {
  let resolveOld!: (value: unknown) => void;
  (searchCollectionRestaurants as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ items: [makeRestaurant({ id: "new", name: "New result" })], hasMore: false, nextCursor: null });
  await mount(); await search("old"); await search("new");
  await act(async () => { resolveOld({ items: [makeRestaurant({ id: "old", name: "Old result" })], hasMore: false, nextCursor: null }); });
  expect(choices()).toHaveLength(1); expect(choices()[0].props.accessibilityLabel).toContain("New result");
});
test("previously permitted location contributes without a new permission prompt", async () => {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 18, longitude: -76.8 } });
  await mount(); expect(loadCollectionSuggestions).toHaveBeenCalledWith("owner", ["existing"], { latitude: 18, longitude: -76.8 });
});
