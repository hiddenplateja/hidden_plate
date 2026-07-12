// src/components/auth/OtpForm.tsx
// Shared 6-digit OTP entry: code input, inline errors, a Verify button, and a
// resend control with a 30s cooldown. Used by the signup wizard's OTP step and
// the existing-user verify-email gate. The caller owns sending the first code
// (or pass `autoSend` to have this fire it on mount) and supplies onVerify /
// onResend.

import { RotateCw } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

const RESEND_COOLDOWN = 30;

interface OtpFormProps {
  email: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  /** Send the first code on mount (the verify gate has no prior screen). */
  autoSend?: boolean;
}

export function OtpForm({
  email,
  onVerify,
  onResend,
  autoSend = false,
}: OtpFormProps) {
  const { styles, colors } = useThemedStyles(makeStyles);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A code is dispatched as we arrive (by the previous screen, or by autoSend),
  // so start the cooldown immediately to avoid an instant resend → server 429.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const didInit = useRef(false);

  const resend = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      await onResend();
      setCooldown(RESEND_COOLDOWN);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setSending(false);
    }
  }, [onResend]);

  // Optionally send the first code once, on mount.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (autoSend) resend();
  }, [autoSend, resend]);

  // Cooldown tick.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = useCallback(async () => {
    if (code.length !== 6 || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      await onVerify(code);
      // success — the caller navigates away; keep the button in its loading state
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
      setCode("");
      setVerifying(false);
    }
  }, [code, verifying, onVerify]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.subtitle}>
        Enter the 6-digit code we sent to{"\n"}
        <Text style={styles.email}>{email}</Text>
      </Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => {
          setError(null);
          setCode(t.replace(/\D/g, "").slice(0, 6));
        }}
        placeholder="••••••"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        editable={!verifying}
        returnKeyType="done"
        onSubmitEditing={verify}
        accessibilityLabel="Verification code"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label="Verify"
        onPress={verify}
        disabled={code.length !== 6}
        loading={verifying}
        style={styles.verifyBtn}
      />

      {/* Resend is the prominent, in-place recovery action — tapping it sends a
          new code and keeps you on this screen (no navigation). Greyed with a
          live countdown until the server's cooldown clears. */}
      <View style={styles.resendRow}>
        {cooldown > 0 ? (
          <Text style={styles.resendMuted}>
            {sending
              ? "Sending…"
              : sent
                ? `New code sent · resend in ${cooldown}s`
                : `Didn't get it? Resend in ${cooldown}s`}
          </Text>
        ) : (
          <Pressable
            onPress={resend}
            disabled={sending}
            hitSlop={8}
            style={styles.resendBtn}
            accessibilityRole="button"
            accessibilityLabel="Resend verification code"
          >
            <RotateCw size={15} color={colors.primary} strokeWidth={2.2} />
            <Text style={styles.resendLink}>
              {sending ? "Sending…" : "Resend code"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    wrap: { width: "100%", alignItems: "center" },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
      marginBottom: spacing.xl,
    },
    email: { fontFamily: fonts.bold, color: colors.textPrimary },
    codeInput: {
      width: "100%",
      height: 64,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: "transparent",
      backgroundColor: colors.surface,
      textAlign: "center",
      fontFamily: fonts.black,
      fontSize: 30,
      letterSpacing: 12,
      color: colors.textPrimary,
    },
    error: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.error,
      marginTop: spacing.sm,
      textAlign: "center",
    },
    verifyBtn: { width: "100%", marginTop: spacing.lg },
    resendRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.lg,
    },
    resendBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.primaryLight,
    },
    resendMuted: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textMuted,
    },
    resendLink: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.primary,
    },
  });
}
