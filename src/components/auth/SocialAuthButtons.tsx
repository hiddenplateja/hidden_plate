// src/components/auth/SocialAuthButtons.tsx
// Apple (iOS only) + Google sign-in buttons, shared by the login screen and the
// signup landing so the two stay visually identical. Handlers are supplied by
// the caller — real OAuth on login, a "coming soon" notice on signup for now.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Platform, StyleSheet, View } from "react-native";

import { GoogleLogo } from "@/components/icons/GoogleLogo";
import { Button } from "@/components/ui/Button";
import { spacing } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";

type Busy = "apple" | "google" | null;

interface SocialAuthButtonsProps {
  onApple: () => void;
  onGoogle: () => void;
  busy?: Busy;
  disabled?: boolean;
}

export function SocialAuthButtons({
  onApple,
  onGoogle,
  busy = null,
  disabled = false,
}: SocialAuthButtonsProps) {
  const { colors } = useTheme();
  const anyBusy = busy !== null;

  return (
    <View style={styles.wrap}>
      {Platform.OS === "ios" ? (
        <Button
          label="Continue with Apple"
          onPress={onApple}
          variant="secondary"
          loading={busy === "apple"}
          disabled={disabled || (anyBusy && busy !== "apple")}
          leftIcon={
            <MaterialCommunityIcons
              name="apple"
              size={20}
              color={colors.textPrimary}
            />
          }
          style={styles.btn}
        />
      ) : null}

      <Button
        label="Continue with Google"
        onPress={onGoogle}
        variant="secondary"
        loading={busy === "google"}
        disabled={disabled || (anyBusy && busy !== "google")}
        leftIcon={<GoogleLogo size={20} />}
        style={styles.btn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  btn: { marginBottom: spacing.sm },
});
