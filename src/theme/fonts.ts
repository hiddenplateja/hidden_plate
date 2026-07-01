// src/theme/fonts.ts
// Centralized font loading. Called once at the root layout.
//
// useAppFonts() returns true once the fonts are loaded. Until then, the
// app should show a splash/loading state to avoid the "fonts loaded mid-render"
// flicker that looks unprofessional.
//
// Font experiment: we load Inter, Plus Jakarta Sans, and Manrope (plus Roboto
// as the fallback) so you can A/B them. Which one is ACTIVE is chosen by the
// single `ACTIVE_FONT` switch in theme/colors.ts. We deliberately load only
// weights 400/500/600/700 — the app maps "bold" → 600 and "black" → 700 so the
// geometric sans options don't read too heavy.

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  Roboto_900Black,
} from "@expo-google-fonts/roboto";
import { useFonts } from "expo-font";

export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    // Inter
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Plus Jakarta Sans
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    // Manrope
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    // Roboto (fallback option)
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
  });
  return loaded;
}
