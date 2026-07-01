// app/list/_layout.tsx
// Stack for the Collections screens (My Collections, detail, create, edit).

import { Stack } from "expo-router";

export default function ListLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, animation: "slide_from_right" }}
    />
  );
}
