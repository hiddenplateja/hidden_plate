// app/list/new.tsx
// Create a new Collection. Accepts an optional ?restaurantId= to seed the
// first spot (used by the "Add to collection → New collection" flow).

import { ArrowLeft } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListForm, type ListFormValues } from "@/components/ListForm";
import { addToList, createList } from "@/services/lists";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

export default function NewListScreen() {
  const router = useRouter();
  const { restaurantId } = useLocalSearchParams<{ restaurantId?: string }>();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values: ListFormValues) => {
    setSubmitting(true);
    try {
      const list = await createList({
        title: values.title,
        description: values.description,
        isPublic: values.isPublic,
      });
      // Seed the first spot if we came from a restaurant. Best-effort: a failed
      // add still lands the user on their new (empty) collection.
      if (restaurantId) {
        try {
          await addToList(list.id, restaurantId);
        } catch {
          // ignore — they can add it again from the restaurant page
        }
      }
      // Replace so Back doesn't return to the form.
      router.replace({ pathname: "/list/[id]", params: { id: list.id } });
    } catch (e) {
      Alert.alert(
        "Couldn't create",
        e instanceof Error ? e.message : "Try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.flex}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.backBtn}
          >
            <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.topTitle}>New collection</Text>
          <View style={styles.backBtn} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          <ListForm
            submitLabel="Create collection"
            submitting={submitting}
            onSubmit={handleSubmit}
          />
        </KeyboardAwareScrollView>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.cardBackground },
    flex: { flex: 1 },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    backBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    topTitle: {
      fontFamily: fonts.bold,
      fontSize: T.size.lg,
      color: colors.textPrimary,
    },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
    },
  });
}
