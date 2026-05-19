// app/restaurant/[id]/_layout.tsx
// Layout for the restaurant detail route group.
// Headers are managed per-screen so the detail can be edge-to-edge.

import { Stack } from "expo-router";

export default function RestaurantLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
