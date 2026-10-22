import { readFileSync } from "fs";
import { resolve } from "path";
import type { ReactElement } from "react";
import ts from "typescript";

// Exercise the screen's actual shared row renderer without mounting its native
// navigation/location dependencies or loading either feed over the network.
const filename = resolve(__dirname, "../../../app/(tabs)/community.tsx");
const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Expression | undefined;
function findRenderer(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "renderItem"
    && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
  ts.forEachChild(node, findRenderer);
}
findRenderer(source);
if (!callback) throw new Error("Community row renderer not found");
const compiled = ts.transpileModule(`const render = ${callback.getText(source)};`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

type Element = ReactElement<Record<string, any>>;
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}
function renderReview(imageIds: string[], coverImageId: string | null = "restaurant-cover") {
  const getImageViewUrl = jest.fn((id: string) => `image://${id}`);
  const setActivePhotoSet = jest.fn(), setActivePhotoIndex = jest.fn();
  const dependencies = {
    currentFeed: { likedIds: new Set() }, user: null, cardStyles: {}, colors: {},
    PARISH_LABELS: {}, formatTimeAgo: () => "just now", getImageViewUrl,
    setActivePhotoSet, setActivePhotoIndex,
    Animated: { View: "AnimatedView" }, FadeInDown: { delay: () => ({ springify: () => null }) },
    ...Object.fromEntries(["Pressable", "View", "Text", "Image", "AuthorAvatar", "MapPin",
      "Star", "Ellipsis", "Heart", "MessageCircle", "Share2"].map(name => [name, name])),
  };
  const render = new Function("require", "exports", ...Object.keys(dependencies), `${compiled}; return render;`)(
    require, {}, ...Object.values(dependencies),
  );
  const nodes = elements(render({ index: 0, item: {
    kind: "review", author: null,
    restaurant: { name: "Test restaurant", parish: "kingston", coverImageId, imageIds: ["restaurant-photo"] },
    review: { id: "review", userId: "author", restaurantId: "restaurant", rating: 4,
      createdAt: "2026-10-20", comment: "Great food", imageIds, likeCount: 0, commentCount: 0 },
  } }));
  return { nodes, getImageViewUrl, setActivePhotoSet, setActivePhotoIndex };
}

test.each(["restaurant-cover", null])("a photo-free review never borrows restaurant photos (cover: %s)", cover => {
  const { nodes, getImageViewUrl } = renderReview([], cover);
  expect(nodes.filter(node => node.type === "Image")).toHaveLength(0);
  expect(getImageViewUrl).not.toHaveBeenCalled();
  expect(nodes.some(node => node.type === "Text" && node.props.children === "Great food")).toBe(true);
  expect(nodes.filter(node => node.type === "Star")).toHaveLength(5);
});

test.each([["review-photo"], ["review-photo", "review-photo-2"]])("uploaded review photos stay visible and open the original gallery (%s)", (...photos) => {
  const { nodes, getImageViewUrl, setActivePhotoSet, setActivePhotoIndex } = renderReview(photos);
  const image = nodes.find(node => node.type === "Image")!;
  expect(nodes.filter(node => node.type === "Image")).toHaveLength(1);
  expect(image.props.source).toEqual({ uri: "image://review-photo" });
  expect(getImageViewUrl).toHaveBeenCalledTimes(1);
  expect(getImageViewUrl).toHaveBeenCalledWith("review-photo");
  const photoButton = nodes.find(node => node.type === "Pressable"
    && Array.isArray(node.props.children) && node.props.children.includes(image))!;
  photoButton.props.onPress({ stopPropagation: jest.fn() });
  expect(setActivePhotoSet).toHaveBeenCalledWith(photos);
  expect(setActivePhotoIndex).toHaveBeenCalledWith(0);
});
