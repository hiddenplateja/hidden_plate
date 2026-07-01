// app/claim/[id].tsx
// "Claim your restaurant" — a signed-in user submits a claim that an admin
// reviews. Owner edits stay admin-only in v1; an approved claim grants the
// verified-owner badge + respond-to-reviews + (later) buy-featured.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import {
  createClaim,
  getMyClaimForRestaurant,
  type ClaimRole,
  type RestaurantClaim,
} from "@/services/claims";
import { getRestaurantById } from "@/services/restaurants";
import { captureError } from "@/services/sentry";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { Restaurant } from "@/types/restaurant";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keep only digits + common phone punctuation, so letters can't be typed. */
function sanitizePhone(text: string): string {
  return text.replace(/[^0-9+\-()\s]/g, "");
}
function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

interface ClaimValues {
  name: string;
  phone: string;
  email: string;
  role: ClaimRole;
  note: string;
}

type Load =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      restaurant: Restaurant;
      existingClaim: RestaurantClaim | null;
    };

export default function ClaimRestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { styles, colors } = useThemedStyles(makeStyles);

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoad({ status: "error" });
      return;
    }
    let active = true;
    (async () => {
      try {
        const [restaurant, existingClaim] = await Promise.all([
          getRestaurantById(id),
          getMyClaimForRestaurant(id),
        ]);
        if (active) setLoad({ status: "ready", restaurant, existingClaim });
      } catch (err) {
        captureError(err, { screen: "claim", op: "load", restaurantId: id });
        if (active) setLoad({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const handleSubmit = useCallback(
    async (values: ClaimValues) => {
      if (!id) return;
      setSubmitting(true);
      try {
        await createClaim({
          restaurantId: id,
          contactName: values.name,
          contactPhone: values.phone,
          contactEmail: values.email,
          role: values.role,
          proofNote: values.note,
        });
        Alert.alert(
          "Claim submitted 🎉",
          "Thanks! We'll review your claim and get back to you. You'll get a verified-owner badge once it's approved.",
          [{ text: "Done", onPress: () => router.back() }],
        );
      } catch (err) {
        Alert.alert(
          "Couldn't submit",
          err instanceof Error ? err.message : "Please try again.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [id, router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
        <Text style={styles.headerTitle}>Claim restaurant</Text>
        <View style={{ width: 36 }} />
      </View>

      {load.status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : load.status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.stateTitle}>Couldn&apos;t load this restaurant</Text>
          <Text style={styles.stateBody}>Check your connection and try again.</Text>
        </View>
      ) : (
        <ClaimBody
          styles={styles}
          colors={colors}
          load={load}
          currentUserId={user?.id ?? null}
          defaultName={user?.displayName ?? ""}
          defaultEmail={user?.email ?? ""}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      )}
    </SafeAreaView>
  );
}

interface BodyProps {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  load: Extract<Load, { status: "ready" }>;
  currentUserId: string | null;
  defaultName: string;
  defaultEmail: string;
  submitting: boolean;
  onSubmit: (values: ClaimValues) => void;
}

interface FieldErrors {
  name?: string;
  phone?: string;
  email?: string;
}

function ClaimBody({
  styles,
  colors,
  load,
  currentUserId,
  defaultName,
  defaultEmail,
  submitting,
  onSubmit,
}: BodyProps) {
  const { restaurant, existingClaim } = load;

  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [role, setRole] = useState<ClaimRole>("owner");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const nameError = (v: string) =>
    v.trim().length >= 2 ? undefined : "Please enter your name.";
  const phoneError = (v: string) =>
    digitsOf(v).length >= 7 ? undefined : "Enter a valid phone number.";
  const emailError = (v: string) =>
    EMAIL_RE.test(v.trim()) ? undefined : "Enter a valid email address.";

  const valid = !nameError(name) && !phoneError(phone) && !emailError(email);

  const handleSubmit = () => {
    const next: FieldErrors = {
      name: nameError(name),
      phone: phoneError(phone),
      email: emailError(email),
    };
    setErrors(next);
    if (next.name || next.phone || next.email) return;
    onSubmit({ name, phone, email, role, note });
  };

  // Terminal states — already owned, or a claim already on file.
  const ownedByMe = !!restaurant.ownerId && restaurant.ownerId === currentUserId;
  const ownedByOther =
    !!restaurant.ownerId && restaurant.ownerId !== currentUserId;
  const pending = existingClaim?.status === "pending";

  if (ownedByMe) {
    return (
      <Notice
        styles={styles}
        colors={colors}
        icon="check-decagram"
        title="You manage this listing"
        body="Your claim has been approved — you'll see owner tools on the restaurant page."
      />
    );
  }
  if (ownedByOther) {
    return (
      <Notice
        styles={styles}
        colors={colors}
        icon="account-lock-outline"
        title="Already claimed"
        body="Someone has already claimed this restaurant. If that's a mistake, contact support."
      />
    );
  }
  if (pending) {
    return (
      <Notice
        styles={styles}
        colors={colors}
        icon="clock-outline"
        title="Claim under review"
        body="We've got your claim and we're reviewing it. We'll be in touch soon."
      />
    );
  }

  return (
    <View style={styles.flex}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <Text style={styles.restaurantName}>{restaurant.name}</Text>
        <Text style={styles.intro}>
          Tell us how to verify you represent this business. We review every
          claim manually and grant a verified-owner badge once approved.
        </Text>

        <Input
          label="Your name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
          }}
          onBlur={() => setErrors((e) => ({ ...e, name: nameError(name) }))}
          error={errors.name}
          placeholder="Full name"
          autoCapitalize="words"
          editable={!submitting}
        />
        <Input
          label="Contact phone"
          value={phone}
          onChangeText={(t) => {
            setPhone(sanitizePhone(t));
            if (errors.phone) setErrors((e) => ({ ...e, phone: undefined }));
          }}
          onBlur={() => setErrors((e) => ({ ...e, phone: phoneError(phone) }))}
          error={errors.phone}
          placeholder="e.g. 876 555 0123"
          keyboardType="phone-pad"
          editable={!submitting}
        />
        <Input
          label="Contact email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          onBlur={() => setErrors((e) => ({ ...e, email: emailError(email) }))}
          error={errors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          editable={!submitting}
        />

        <Text style={styles.label}>Your role</Text>
        <View style={styles.roleRow}>
          {(["owner", "manager"] as ClaimRole[]).map((r) => {
            const active = role === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                style={[styles.roleChip, active && styles.roleChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.roleText, active && styles.roleTextActive]}
                >
                  {r === "owner" ? "Owner" : "Manager"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Input
          label="Anything that helps us verify? (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Business email domain, your title, social handle…"
          multiline
          style={styles.noteInput}
          editable={!submitting}
        />

        <View style={styles.submitWrap}>
          <Button
            label="Submit claim"
            onPress={handleSubmit}
            loading={submitting}
            disabled={!valid}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function Notice({
  styles,
  colors,
  icon,
  title,
  body,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.noticeIcon}>
        <MaterialCommunityIcons name={icon} size={32} color={colors.primary} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    backBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xxxl,
      gap: spacing.sm,
    },
    noticeIcon: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    stateTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.xl,
      color: colors.textPrimary,
      textAlign: "center",
    },
    stateBody: {
      fontFamily: fonts.regular,
      fontSize: T.size.base,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
    },
    scroll: {
      padding: spacing.lg,
      paddingBottom: spacing.xl,
    },
    restaurantName: {
      fontFamily: fonts.black,
      fontSize: T.size.xxl,
      color: colors.textPrimary,
      letterSpacing: T.tracking.tight,
      marginBottom: spacing.xs,
    },
    intro: {
      fontFamily: fonts.regular,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    label: {
      fontFamily: fonts.medium,
      fontSize: T.size.sm,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    roleRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    roleChip: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    roleChipActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    roleText: {
      fontFamily: fonts.bold,
      fontSize: T.size.sm,
      color: colors.textSecondary,
    },
    roleTextActive: { color: colors.primary },
    noteInput: {
      minHeight: 90,
      paddingTop: spacing.md,
      textAlignVertical: "top",
    },
    submitWrap: { marginTop: spacing.lg },
  });
}
