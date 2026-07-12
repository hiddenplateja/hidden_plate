// app/list/edit/[id].tsx
// Edit a Collection's name / description / visibility.

import { ArrowLeft } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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

import { ListForm, type ListFormValues } from "@/components/ListForm";
import { getList, updateList } from "@/services/lists";
import { fonts, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type { List } from "@/types/list";

export default function EditListScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { styles, colors } = useThemedStyles(makeStyles);
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    getList(id)
      .then((l) => active && setList(l))
      .catch(() => active && setList(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const handleSubmit = async (values: ListFormValues) => {
    setSubmitting(true);
    try {
      await updateList(id, {
        title: values.title,
        description: values.description || null,
        isPublic: values.isPublic,
      });
      router.back();
    } catch (e) {
      Alert.alert(
        "Couldn't save",
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
          <Text style={styles.topTitle}>Edit collection</Text>
          <View style={styles.backBtn} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !list ? (
          <View style={styles.center}>
            <Text style={styles.error}>Couldn&apos;t load this collection.</Text>
          </View>
        ) : (
          <KeyboardAwareScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bottomOffset={24}
          >
            <ListForm
              initial={{
                title: list.title,
                description: list.description ?? "",
                isPublic: list.isPublic,
              }}
              submitLabel="Save changes"
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          </KeyboardAwareScrollView>
        )}
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
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    error: {
      fontFamily: fonts.medium,
      fontSize: T.size.base,
      color: colors.error,
    },
  });
}
