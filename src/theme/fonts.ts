// src/theme/fonts.ts
// Centralized font loading. Called once at the root layout.
//
// useAppFonts() returns true once the fonts are loaded. Until then, the
// app should show a splash/loading state to avoid the "fonts loaded mid-render"
// flicker that looks unprofessional.

import {
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
    useFonts as useRoboto,
} from "@expo-google-fonts/roboto";

export function useAppFonts(): boolean {
  const [loaded] = useRoboto({
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
  });
  return loaded;
}
