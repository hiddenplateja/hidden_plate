import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import ClaimRestaurantScreen from "../../../app/claim/[id]";
import { useAuth } from "@/hooks/useAuth";
import { createClaim, getMyClaimForRestaurant } from "@/services/claims";
import { getRestaurantById } from "@/services/restaurants";
import { makeRestaurant } from "@/utils/__tests__/fixtures";

jest.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", Alert: { alert: jest.fn() }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
jest.mock("react-native-keyboard-controller", () => ({ KeyboardAwareScrollView: "KeyboardAwareScrollView" }));
jest.mock("lucide-react-native", () => Object.fromEntries(["ArrowLeft", "BadgeCheck", "Clock", "Lock"].map(name => [name, name])));
jest.mock("expo-router", () => ({ useRouter: () => router, useLocalSearchParams: () => ({ id: "restaurant" }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    refocus = callback;
    React.useEffect(() => { focusCleanup = callback(); return focusCleanup; }, [callback]);
  },
}));
jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/services/claims", () => ({ createClaim: jest.fn(), getMyClaimForRestaurant: jest.fn() }));
jest.mock("@/services/restaurants", () => ({ getRestaurantById: jest.fn() }));
jest.mock("@/services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("@/components/ui/Input", () => ({ Input: "Input" }));
jest.mock("@/components/ui/Button", () => ({ Button: "Button" }));
jest.mock("@/theme/useThemedStyles", () => ({ useThemedStyles: (factory: any) => {
  const { colors } = jest.requireActual("@/theme/colors"); return { colors, styles: factory(colors) };
} }));
const router = { back: jest.fn() };
const user = { id: "claimant", displayName: "Fixture Owner", email: "owner@example.test" };
const pending = { id: "claim", restaurantId: "restaurant", userId: user.id, status: "pending" };
let renderer: ReactTestRenderer | undefined, consoleError: jest.SpyInstance;
let refocus: () => void | (() => void), focusCleanup: void | (() => void);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const submitButtons = () => renderer!.root.findAll(node => String(node.type) === "Button" && node.props.label === "Submit claim");
const hasText = (text: string) => renderer!.root.findAll(node => String(node.type) === "Text" && node.props.children === text).length > 0;
async function mount() { await act(async () => { renderer = create(React.createElement(ClaimRestaurantScreen)); }); }
async function fillPhone() { await act(async () => { renderer!.root.findByProps({ label: "Contact phone" }).props.onChangeText("8765551234"); }); }
beforeEach(() => {
  jest.resetAllMocks();
  const original = console.error;
  consoleError = jest.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated.")) original(...args); });
  (useAuth as jest.Mock).mockReturnValue({ user });
  (getRestaurantById as jest.Mock).mockResolvedValue(makeRestaurant({ id: "restaurant" }));
  (getMyClaimForRestaurant as jest.Mock).mockResolvedValue(null);
  (createClaim as jest.Mock).mockResolvedValue(pending);
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; consoleError.mockRestore(); });

test("an existing pending claim shows under-review notice, not a submission form", async () => {
  (getMyClaimForRestaurant as jest.Mock).mockResolvedValue(pending);
  await mount(); expect(hasText("Claim under review")).toBe(true); expect(submitButtons()).toHaveLength(0);
});
test("successful submission immediately locks the form even before dismissing the success alert", async () => {
  await mount(); await fillPhone();
  await act(async () => { submitButtons()[0].props.onPress(); });
  expect(createClaim).toHaveBeenCalledTimes(1); expect(hasText("Claim under review")).toBe(true);
  expect(submitButtons()).toHaveLength(0); expect(router.back).not.toHaveBeenCalled();
});
test("double taps cannot start two claim requests", async () => {
  let finish!: (value: unknown) => void;
  (createClaim as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fillPhone(); const press = submitButtons()[0].props.onPress;
  await act(async () => { press(); press(); }); expect(createClaim).toHaveBeenCalledTimes(1);
  await act(async () => { finish(pending); }); expect(submitButtons()).toHaveLength(0);
});
test("rejection permits a fresh submission and focus refresh observes admin decisions", async () => {
  (getMyClaimForRestaurant as jest.Mock).mockResolvedValue(pending);
  await mount();
  (getMyClaimForRestaurant as jest.Mock).mockResolvedValue({ ...pending, status: "rejected" });
  await act(async () => { focusCleanup?.(); focusCleanup = refocus(); });
  expect(submitButtons()).toHaveLength(1); await fillPhone();
  await act(async () => { submitButtons()[0].props.onPress(); }); expect(createClaim).toHaveBeenCalledTimes(1);
});
test("approval plus ownership shows owner tools notice rather than another claim form", async () => {
  (getRestaurantById as jest.Mock).mockResolvedValue(makeRestaurant({ ownerId: user.id }));
  (getMyClaimForRestaurant as jest.Mock).mockResolvedValue({ ...pending, status: "approved" });
  await mount(); expect(hasText("You manage this listing")).toBe(true); expect(submitButtons()).toHaveLength(0);
});
test("another owner's restaurant cannot be claimed", async () => {
  (getRestaurantById as jest.Mock).mockResolvedValue(makeRestaurant({ ownerId: "another-owner" }));
  await mount(); expect(hasText("Already claimed")).toBe(true); expect(submitButtons()).toHaveLength(0);
});
test("a failed claim status check never opens a claim form", async () => {
  (getMyClaimForRestaurant as jest.Mock).mockRejectedValue(new Error("Offline"));
  await mount(); expect(hasText("Couldn't load this restaurant")).toBe(true); expect(submitButtons()).toHaveLength(0);
});
test("switching accounts discards pending state and ignores a previous account's late submission", async () => {
  let finish!: (value: unknown) => void;
  (createClaim as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fillPhone(); await act(async () => { submitButtons()[0].props.onPress(); });
  (useAuth as jest.Mock).mockReturnValue({ user: { ...user, id: "next-account" } });
  await act(async () => { renderer!.update(React.createElement(ClaimRestaurantScreen)); });
  await act(async () => { finish(pending); });
  expect(submitButtons()).toHaveLength(1); expect(hasText("Claim under review")).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
});
