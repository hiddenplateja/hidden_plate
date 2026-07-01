// app/(auth)/_layout.tsx
// Auth group layout — login + signup share these options.

import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="signup-email" />
      <Stack.Screen name="signup-otp" />
      <Stack.Screen name="signup-profile" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
      <Stack.Screen
        name="oauth-username"
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="verify-email" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
