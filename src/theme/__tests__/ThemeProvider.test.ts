import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { lightColors, darkColors } from "@/theme/themes";

jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock("react-native", () => ({ useColorScheme: jest.fn() }));
let renderer: ReactTestRenderer | undefined;
let current: ReturnType<typeof useTheme>, frames: { mode: string; isDark: boolean }[], consoleError: jest.SpyInstance;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Probe() { current = useTheme(); frames.push({ mode: current.mode, isDark: current.isDark }); return null; }
async function mount() { await act(async () => { renderer = create(React.createElement(ThemeProvider, null, React.createElement(Probe))); }); }
beforeEach(() => {
  jest.resetAllMocks(); frames = [];
  (useColorScheme as jest.Mock).mockReturnValue("dark");
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  const original = console.error;
  consoleError = jest.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated.")) original(...args); });
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; consoleError.mockRestore(); });

test("fresh launches use light mode from the first render even on a dark-mode device", async () => {
  await mount();
  expect(frames.every(frame => frame.mode === "light" && !frame.isDark)).toBe(true);
  expect(current.colors).toBe(lightColors);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test.each(["light", "dark", "system"])("saved %s preferences still restore", async mode => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(mode);
  await mount(); expect(current.mode).toBe(mode);
  expect(current.isDark).toBe(mode !== "light");
  expect(AsyncStorage.getItem).toHaveBeenCalledWith("@hp_theme_mode");
});
test.each([null, "unknown"])("missing/invalid preference %s falls back to light", async stored => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored);
  await mount(); expect(current.mode).toBe("light"); expect(current.colors).toBe(lightColors);
});
test("storage failures retain light mode", async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error("Unavailable"));
  await mount(); expect(current.mode).toBe("light"); expect(current.isDark).toBe(false);
});
test("users can still choose and persist dark mode", async () => {
  await mount(); await act(async () => { current.setMode("dark"); });
  expect(current.colors).toBe(darkColors);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith("@hp_theme_mode", "dark");
});
test("explicit system mode continues following device appearance", async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue("system");
  await mount(); expect(current.isDark).toBe(true);
  (useColorScheme as jest.Mock).mockReturnValue("light");
  await act(async () => { renderer!.update(React.createElement(ThemeProvider, null, React.createElement(Probe))); });
  expect(current.isDark).toBe(false); expect(current.mode).toBe("system");
});
