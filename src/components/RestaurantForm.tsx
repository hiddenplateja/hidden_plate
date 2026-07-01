// src/components/RestaurantForm.tsx
// Shared restaurant form used by:
//   - the public "Add a Restaurant" submission screen (app/add-restaurant.tsx)
//   - the admin add/edit screens (app/admin/restaurants/new|[id])
//
// The form owns all field state, photo handling (including existing images in
// edit mode), the optional opening-hours editor, and image upload at submit
// time. It then calls `onSubmit(values)` with a resolved payload — the parent
// decides whether that means createRestaurant or updateRestaurant, and handles
// success (navigation / confirmation). `admin` reveals Active/Verified/Featured
// toggles. The screen provides its own header/SafeAreaView around this.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import {
  ImagePickerField,
  type PickedPhoto,
} from "@/components/ImagePickerField";
import { LocationPickerMap, type LatLng } from "@/components/LocationPickerMap";
import { MenuEditor } from "@/components/MenuEditor";
import { Button } from "@/components/ui/Button";
import {
  CATEGORY_OPTIONS,
  CUISINE_OPTIONS,
  DAY_OPTIONS,
  PARISH_OPTIONS,
  PRICE_OPTIONS,
} from "@/constants/restaurantOptions";
import {
  compressImage,
  deleteImage,
  getImageViewUrl,
  uploadRestaurantImage,
} from "@/services/storage";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
import type {
  MenuSection,
  OpeningHours,
  Parish,
  PriceRange,
  Restaurant,
} from "@/types/restaurant";

const MAX_PHOTOS = 5;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function pad(n: string): string {
  const [h, m] = n.trim().split(":");
  return `${String(Number(h)).padStart(2, "0")}:${m}`;
}

// Map stored (lowercase) tags back to their display-cased option labels so
// chips show as selected in edit mode. Unknown tags pass through unchanged.
function toDisplayTags(stored: string[], options: string[]): string[] {
  return stored.map(
    (s) => options.find((o) => o.toLowerCase() === s.toLowerCase()) ?? s,
  );
}

export interface RestaurantFormValues {
  name: string;
  description: string | null;
  address: string;
  parish: Parish;
  city: string | null;
  latitude: number;
  longitude: number;
  phoneNumber: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  priceRange: PriceRange | null;
  cuisines: string[];
  categories: string[];
  imageIds: string[];
  coverImageId: string | null;
  openingHours: OpeningHours | null;
  menu: MenuSection[];
  isActive?: boolean;
  isVerified?: boolean;
  isFeatured?: boolean;
}

interface RestaurantFormProps {
  /** Existing restaurant to edit. Omit for create. */
  initial?: Restaurant | null;
  /** Show admin-only Active/Verified/Featured toggles + send those values. */
  admin?: boolean;
  submitLabel: string;
  /** Optional helper text shown above the form. */
  intro?: string;
  /** Parent performs the create/update + success handling. */
  onSubmit: (values: RestaurantFormValues) => Promise<void>;
}

export function RestaurantForm({
  initial,
  admin = false,
  submitLabel,
  intro,
  onSubmit,
}: RestaurantFormProps) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const initialHours = initial?.openingHours ?? null;
  const firstSlot = initialHours
    ? Object.values(initialHours)
        .flat()
        .find(Boolean) ?? null
    : null;

  const [photos, setPhotos] = useState<PickedPhoto[]>(() => {
    if (!initial) return [];
    // Seed the cover first (so it stays the cover on save), then the gallery.
    // This also covers legacy rows where coverImageId isn't inside imageIds —
    // without it, saving an edit would wipe the cover image.
    const cover = initial.coverImageId;
    const ids = cover
      ? [cover, ...initial.imageIds.filter((id) => id !== cover)]
      : initial.imageIds;
    return ids.map((fid) => ({
      uri: getImageViewUrl(fid),
      existingFileId: fid,
    }));
  });
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cuisines, setCuisines] = useState<string[]>(
    toDisplayTags(initial?.cuisines ?? [], CUISINE_OPTIONS),
  );
  const [categories, setCategories] = useState<string[]>(
    toDisplayTags(initial?.categories ?? [], CATEGORY_OPTIONS),
  );
  const [priceRange, setPriceRange] = useState<PriceRange | null>(
    initial?.priceRange ?? null,
  );
  const [address, setAddress] = useState(initial?.address ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [parish, setParish] = useState<Parish | null>(initial?.parish ?? null);
  const [coords, setCoords] = useState<LatLng | null>(
    initial
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [recenterToken, setRecenterToken] = useState(0);
  const [locating, setLocating] = useState(false);
  const [phone, setPhone] = useState(initial?.phoneNumber ?? "");
  const [website, setWebsite] = useState(initial?.websiteUrl ?? "");
  const [instagram, setInstagram] = useState(initial?.instagramHandle ?? "");

  const [hoursEnabled, setHoursEnabled] = useState(!!initialHours);
  const [menu, setMenu] = useState<MenuSection[]>(initial?.menu ?? []);
  const [openDays, setOpenDays] = useState<Set<keyof OpeningHours>>(() => {
    if (!initialHours) return new Set(DAY_OPTIONS.map((d) => d.key));
    const days = new Set<keyof OpeningHours>();
    for (const d of DAY_OPTIONS) {
      if (initialHours[d.key]?.length) days.add(d.key);
    }
    return days.size ? days : new Set(DAY_OPTIONS.map((d) => d.key));
  });
  const [openTime, setOpenTime] = useState(firstSlot?.open ?? "09:00");
  const [closeTime, setCloseTime] = useState(firstSlot?.close ?? "21:00");

  // Admin flags. New restaurants default to published; edits keep their value.
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isVerified, setIsVerified] = useState(initial?.isVerified ?? false);
  const [isFeatured, setIsFeatured] = useState(initial?.isFeatured ?? false);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const toggleIn = (
    list: string[],
    setList: (v: string[]) => void,
    value: string,
  ) => {
    setList(
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );
  };

  const toggleDay = (key: keyof OpeningHours) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleUseCurrentLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location access needed",
          "Allow location access to drop the pin where you are, or tap the map instead.",
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setRecenterToken((t) => t + 1);
    } catch {
      Alert.alert(
        "Couldn't get location",
        "Tap the map to set the pin instead.",
      );
    } finally {
      setLocating(false);
    }
  }, []);

  const buildOpeningHours = useCallback((): OpeningHours | null => {
    if (!hoursEnabled) return null;
    if (!TIME_RE.test(openTime) || !TIME_RE.test(closeTime)) {
      throw new Error("Enter opening times as HH:MM (e.g. 09:00).");
    }
    const slot = { open: pad(openTime), close: pad(closeTime) };
    const result: OpeningHours = {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    };
    for (const d of DAY_OPTIONS) {
      if (openDays.has(d.key)) result[d.key] = [slot];
    }
    return result;
  }, [hoursEnabled, openTime, closeTime, openDays]);

  const handleSubmit = useCallback(async () => {
    if (name.trim().length < 2) {
      Alert.alert("Add a name", "What's the restaurant called?");
      return;
    }
    if (!address.trim()) {
      Alert.alert("Add an address", "Where is it located?");
      return;
    }
    if (!parish) {
      Alert.alert("Choose a parish", "Pick the parish it's in.");
      return;
    }
    if (!coords) {
      Alert.alert(
        "Set the location",
        "Tap the map to drop a pin, or use your current location.",
      );
      return;
    }
    if (cuisines.length === 0 && categories.length === 0) {
      Alert.alert(
        "Pick a category",
        "Choose at least one cuisine or category so people can find it.",
      );
      return;
    }

    let openingHours: OpeningHours | null;
    try {
      openingHours = buildOpeningHours();
    } catch (err) {
      Alert.alert("Check the hours", err instanceof Error ? err.message : "");
      return;
    }

    setSubmitting(true);
    const newlyUploaded: string[] = [];
    try {
      const keptIds = photos
        .filter((p) => p.existingFileId)
        .map((p) => p.existingFileId as string);
      const toUpload = photos.filter((p) => !p.existingFileId);

      for (let i = 0; i < toUpload.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${toUpload.length}…`);
        try {
          const compressed = await compressImage(toUpload[i].uri);
          const id = await uploadRestaurantImage(compressed);
          newlyUploaded.push(id);
        } catch (err) {
          await Promise.all(newlyUploaded.map((fid) => deleteImage(fid)));
          throw err;
        }
      }

      const imageIds = [...keptIds, ...newlyUploaded];
      setProgress("Saving…");
      await onSubmit({
        name,
        description: description.trim() || null,
        address,
        parish,
        city: city.trim() || null,
        latitude: coords.latitude,
        longitude: coords.longitude,
        phoneNumber: phone.trim() || null,
        websiteUrl: website.trim() || null,
        instagramHandle: instagram.trim() || null,
        priceRange,
        cuisines,
        categories,
        imageIds,
        coverImageId: imageIds[0] ?? null,
        openingHours,
        menu,
        ...(admin ? { isActive, isVerified, isFeatured } : {}),
      });
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }, [
    name,
    address,
    parish,
    coords,
    cuisines,
    categories,
    buildOpeningHours,
    menu,
    photos,
    description,
    city,
    phone,
    website,
    instagram,
    priceRange,
    admin,
    isActive,
    isVerified,
    isFeatured,
    onSubmit,
  ]);

  return (
    <View style={styles.flex}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        {intro ? <Text style={styles.intro}>{intro}</Text> : null}

        {/* Admin flags */}
        {admin ? (
          <View style={styles.flags}>
            <FlagRow
              label="Published"
              hint="Visible in the app"
              value={isActive}
              onChange={setIsActive}
              disabled={submitting}
            />
            <FlagRow
              label="Verified"
              hint="Shows the verified badge"
              value={isVerified}
              onChange={setIsVerified}
              disabled={submitting}
            />
            <FlagRow
              label="Featured"
              hint="Eligible for featured spots"
              value={isFeatured}
              onChange={setIsFeatured}
              disabled={submitting}
            />
          </View>
        ) : null}

        {/* Photos */}
        <SectionLabel hint="First photo becomes the cover">Photos</SectionLabel>
        <ImagePickerField
          photos={photos}
          onChange={setPhotos}
          max={MAX_PHOTOS}
          disabled={submitting}
        />

        {/* Name */}
        <SectionLabel required>Name</SectionLabel>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Scotchies"
          placeholderTextColor={colors.textMuted}
          editable={!submitting}
          maxLength={120}
        />

        {/* Description */}
        <SectionLabel hint="Optional">Description</SectionLabel>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="What makes this place special? The food, the vibe…"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          editable={!submitting}
          maxLength={1000}
        />

        {/* Cuisines */}
        <SectionLabel required hint="Pick all that apply">
          Cuisine
        </SectionLabel>
        <View style={styles.chipWrap}>
          {CUISINE_OPTIONS.map((c) => (
            <Chip
              key={c}
              label={c}
              active={cuisines.includes(c)}
              onPress={() => toggleIn(cuisines, setCuisines, c)}
            />
          ))}
        </View>

        {/* Categories */}
        <SectionLabel hint="Optional">Category</SectionLabel>
        <View style={styles.chipWrap}>
          {CATEGORY_OPTIONS.map((c) => (
            <Chip
              key={c}
              label={c}
              active={categories.includes(c)}
              onPress={() => toggleIn(categories, setCategories, c)}
            />
          ))}
        </View>

        {/* Price */}
        <SectionLabel hint="Optional">Price range</SectionLabel>
        <View style={styles.priceRow}>
          {PRICE_OPTIONS.map((p) => {
            const active = priceRange === p.value;
            return (
              <Pressable
                key={p.value}
                onPress={() => setPriceRange(active ? null : p.value)}
                style={[styles.priceBtn, active && styles.priceBtnActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.priceValue, active && styles.priceValueActive]}
                >
                  {p.value}
                </Text>
                <Text
                  style={[styles.priceHint, active && styles.priceHintActive]}
                  numberOfLines={1}
                >
                  {p.hint}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Address */}
        <SectionLabel required>Address</SectionLabel>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="Street address"
          placeholderTextColor={colors.textMuted}
          editable={!submitting}
          maxLength={200}
        />

        {/* City */}
        <SectionLabel hint="Optional">Town / city</SectionLabel>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          placeholder="e.g. Montego Bay"
          placeholderTextColor={colors.textMuted}
          editable={!submitting}
          maxLength={80}
        />

        {/* Parish */}
        <SectionLabel required>Parish</SectionLabel>
        <View style={styles.chipWrap}>
          {PARISH_OPTIONS.map((p) => (
            <Chip
              key={p.value}
              label={p.label}
              active={parish === p.value}
              onPress={() => setParish(p.value)}
            />
          ))}
        </View>

        {/* Location pin */}
        <SectionLabel required hint="Tap the map or drag the pin">
          Location
        </SectionLabel>
        <LocationPickerMap
          value={coords}
          onChange={setCoords}
          recenterToken={recenterToken}
        />
        <View style={styles.locRow}>
          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={locating || submitting}
            style={styles.locBtn}
            accessibilityRole="button"
          >
            {locating ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={18}
                color={colors.primary}
              />
            )}
            <Text style={styles.locBtnText}>Use my current location</Text>
          </Pressable>
          {coords ? (
            <Text style={styles.coordText}>
              {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
            </Text>
          ) : null}
        </View>

        {/* Contact */}
        <SectionLabel hint="Optional">Phone</SectionLabel>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="876-000-0000"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          editable={!submitting}
          maxLength={40}
        />

        <SectionLabel hint="Optional">Website</SectionLabel>
        <TextInput
          style={styles.input}
          value={website}
          onChangeText={setWebsite}
          placeholder="example.com"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="url"
          editable={!submitting}
          maxLength={200}
        />

        <SectionLabel hint="Optional">Instagram</SectionLabel>
        <View style={styles.igRow}>
          <Text style={styles.igAt}>@</Text>
          <TextInput
            style={styles.igInput}
            value={instagram}
            onChangeText={setInstagram}
            placeholder="handle"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            editable={!submitting}
            maxLength={60}
          />
        </View>

        {/* Opening hours */}
        <View style={styles.hoursHeader}>
          <View style={styles.flex}>
            <Text style={styles.sectionLabel}>Opening hours</Text>
            <Text style={styles.sectionHint}>Optional</Text>
          </View>
          <Switch
            value={hoursEnabled}
            onValueChange={setHoursEnabled}
            disabled={submitting}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        {hoursEnabled ? (
          <View style={styles.hoursBody}>
            <Text style={styles.hoursSub}>Open on</Text>
            <View style={styles.chipWrap}>
              {DAY_OPTIONS.map((d) => (
                <Chip
                  key={d.key}
                  label={d.label}
                  active={openDays.has(d.key)}
                  onPress={() => toggleDay(d.key)}
                />
              ))}
            </View>
            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.hoursSub}>Opens</Text>
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  value={openTime}
                  onChangeText={setOpenTime}
                  placeholder="09:00"
                  placeholderTextColor={colors.textMuted}
                  editable={!submitting}
                  maxLength={5}
                />
              </View>
              <View style={styles.timeField}>
                <Text style={styles.hoursSub}>Closes</Text>
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  value={closeTime}
                  onChangeText={setCloseTime}
                  placeholder="21:00"
                  placeholderTextColor={colors.textMuted}
                  editable={!submitting}
                  maxLength={5}
                />
              </View>
            </View>
            <Text style={styles.hoursNote}>
              Use 24-hour time (e.g. 21:00 = 9pm). Same hours apply to each
              selected day.
            </Text>
          </View>
        ) : null}

        {/* Menu */}
        <SectionLabel hint="Optional — sections like Mains, Drinks">
          Menu
        </SectionLabel>
        <MenuEditor value={menu} onChange={setMenu} disabled={submitting} />

        {progress ? <Text style={styles.progress}>{progress}</Text> : null}

        <View style={styles.submitWrap}>
          <Button label={submitLabel} onPress={handleSubmit} loading={submitting} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionLabel({
  children,
  required,
  hint,
}: {
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>
        {children}
        {required ? <Text style={styles.req}> *</Text> : null}
      </Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function FlagRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { styles, colors } = useThemedStyles(makeStyles);
  return (
    <View style={styles.flagRow}>
      <View style={styles.flex}>
        <Text style={styles.flagLabel}>{label}</Text>
        <Text style={styles.flagHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  intro: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },

  flags: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  flagRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
  },
  flagLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  flagHint: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  req: { color: colors.primary },
  sectionHint: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  textArea: { minHeight: 96 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
  },
  chipTextActive: { color: colors.primary, fontFamily: fonts.bold },

  priceRow: { flexDirection: "row", gap: spacing.sm },
  priceBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  priceBtnActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  priceValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },
  priceValueActive: { color: colors.primary },
  priceHint: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted },
  priceHintActive: { color: colors.primary },

  locRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  locBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
  },
  locBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.primary,
  },
  coordText: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },

  igRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  igAt: {
    fontFamily: fonts.medium,
    fontSize: T.size.base,
    color: colors.textMuted,
    marginRight: 2,
  },
  igInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textPrimary,
  },

  hoursHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  hoursBody: { gap: spacing.sm },
  hoursSub: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  timeRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  timeField: { flex: 1 },
  timeInput: { textAlign: "center" },
  hoursNote: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.xs,
  },

  progress: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  submitWrap: { marginTop: spacing.xl },
  });
}
