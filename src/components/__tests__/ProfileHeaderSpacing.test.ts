import { readFileSync } from "fs";
import { resolve } from "path";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { ProfileHeader } from "@/components/ProfileHeader";
import { fonts, radius, shadows, spacing, typographyTokens } from "@/theme/colors";
import { darkColors, lightColors, type ThemeColors } from "@/theme/themes";

jest.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("lucide-react-native", () => Object.fromEntries(["Ban", "Ellipsis", "Pencil", "Star", "UserCheck"].map(name => [name, name])));
jest.mock("@/components/Avatar", () => ({ Avatar: "Avatar" }));
jest.mock("@/components/DraggableSheet", () => ({ DraggableSheet: "DraggableSheet" }));
jest.mock("@/utils/reviewerBadges", () => ({ getReviewerBadges: () => [] }));
jest.mock("@/theme/useThemedStyles", () => ({ useThemedStyles: (factory: (colors: ThemeColors) => unknown) => ({ styles: factory(palette), colors: palette }) }));

let palette: ThemeColors = lightColors, renderer: ReactTestRenderer | undefined, consoleError: jest.SpyInstance;
const edit = jest.fn();
const user = { id: "user", email: "", username: "test_user", displayName: "Test User", bio: "Food explorer", createdAt: "2026-10-20", avatarUrl: null };
const stats = { reviewCount: 0, averageRating: 0, parishesVisited: 0 };
const follow = { followerCount: 12, followingCount: 8, isFollowing: false };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  jest.clearAllMocks(); palette = lightColors;
  const original = console.error;
  consoleError = jest.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated.")) original(...args); });
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; consoleError.mockRestore(); });

test.each([lightColors, darkColors])("own-profile header uses tighter spacing without changing avatar or edit control", async colors => {
  palette = colors;
  await act(async () => { renderer = create(React.createElement(ProfileHeader, { user, stats, follow, isOwn: true, variant: "centered", onEditPress: edit })); });
  const root = renderer!.root;
  const avatar = root.find(node => String(node.type) === "Avatar");
  expect(avatar.props.size).toBe(80);
  expect(avatar.parent!.props.style.marginBottom).toBe(spacing.sm);
  expect(root.findAll(node => String(node.type) === "View")[0].props.style).toMatchObject({ paddingBottom: spacing.md, backgroundColor: colors.cardBackground });
  const statsRow = root.findAll(node => String(node.type) === "View" && Array.isArray(node.props.style)
    && node.props.style[0]?.justifyContent === "space-around")[0];
  expect(statsRow.props.style[1]).toEqual({ marginTop: spacing.sm });
  const editButton = root.findByProps({ accessibilityLabel: "Edit profile" });
  expect(editButton.props.hitSlop).toBe(6);
  await act(async () => { editButton.props.onPress(); }); expect(edit).toHaveBeenCalledTimes(1);
  expect(root.findAll(node => String(node.type) === "Text").some(node => node.props.children === user.bio)).toBe(true);
});

test("other-user default header keeps its original spacing and avatar", async () => {
  await act(async () => { renderer = create(React.createElement(ProfileHeader, { user, stats, follow, isOwn: false })); });
  const root = renderer!.root;
  expect(root.find(node => String(node.type) === "Avatar").props.size).toBe(88);
  expect(root.findAll(node => String(node.type) === "View")[0].props.style.paddingBottom).toBe(spacing.lg);
  const statsRow = root.findAll(node => String(node.type) === "View" && Array.isArray(node.props.style)
    && node.props.style[0]?.justifyContent === "space-around")[0];
  expect(statsRow.props.style[0].marginTop).toBe(spacing.lg);
});

test("top navigation reduces only top whitespace, retaining icon touch targets", () => {
  // Read the screen's actual private style factory without importing its auth,
  // drawer and native navigation dependencies into this isolated layout test.
  const path = resolve(__dirname, "../../../app/(tabs)/profile.tsx");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const factory = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "makeStyles")!;
  const compiled = ts.transpileModule(factory.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const makeStyles = new Function("StyleSheet", "spacing", "radius", "fonts", "shadows", "T", `${compiled}; return makeStyles;`)(
    { create: (styles: unknown) => styles }, spacing, radius, fonts, shadows, typographyTokens,
  );
  expect(makeStyles(lightColors).topNav).toMatchObject({ paddingTop: spacing.xs, paddingBottom: spacing.xs });
  expect(makeStyles(lightColors).iconBtn).toMatchObject({ width: 40, height: 40 });
});
