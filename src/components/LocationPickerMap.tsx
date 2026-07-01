// src/components/LocationPickerMap.tsx
// Compact map used in the "add a restaurant" form to set a pin.
//
// Interaction: tap anywhere to drop/move the pin, or drag the pin to
// fine-tune. The parent owns the coordinate (value/onChange). To recenter
// the map programmatically (e.g. after "use my current location"), the
// parent bumps `recenterToken` — taps don't recenter, so fine-tuning never
// fights the camera.
//
// react-native-maps is imported the same guarded way as app/(tabs)/map.tsx so
// web bundling (which has no native map) doesn't break — we render a notice
// there instead.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { MAP_STYLE_HIDE_BUSINESS_POIS } from "@/constants/mapStyle";
import { fonts, radius, spacing, typographyTokens as T } from "@/theme/colors";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";

// react-native-maps types come through as `any` here because the module is
// require()'d conditionally (no native map on web) — same as app/(tabs)/map.tsx.
let MapView: any;
let Marker: any;
let PROVIDER_DEFAULT: any;

if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Maps = require("react-native-maps");
  MapView = Maps.default;
  Marker = Maps.Marker;
  PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

// Roughly centers the whole island so the first tap lands somewhere sensible.
const JAMAICA_REGION = {
  latitude: 18.1096,
  longitude: -77.2975,
  latitudeDelta: 1.6,
  longitudeDelta: 1.6,
};

interface LocationPickerMapProps {
  value: LatLng | null;
  onChange: (coord: LatLng) => void;
  /** Bump this to fly the camera to `value` (e.g. after current-location). */
  recenterToken?: number;
  height?: number;
}

export function LocationPickerMap({
  value,
  onChange,
  recenterToken,
  height = 220,
}: LocationPickerMapProps) {
  const mapRef = useRef<any>(null);
  const { styles, colors } = useThemedStyles(makeStyles);

  useEffect(() => {
    if (recenterToken == null || !value) return;
    mapRef.current?.animateToRegion?.(
      { ...value, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    );
  }, [recenterToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (Platform.OS === "web" || !MapView) {
    return (
      <View style={[styles.fallback, { height }]}>
        <MaterialCommunityIcons
          name="map-outline"
          size={28}
          color={colors.textMuted}
        />
        <Text style={styles.fallbackText}>
          The map picker isn&apos;t available on web. Open the app on your phone
          to drop a pin.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        customMapStyle={MAP_STYLE_HIDE_BUSINESS_POIS}
        showsPointsOfInterest={false}
        initialRegion={
          value
            ? { ...value, latitudeDelta: 0.01, longitudeDelta: 0.01 }
            : JAMAICA_REGION
        }
        onPress={(e: any) => onChange(e.nativeEvent.coordinate)}
      >
        {value ? (
          <Marker
            coordinate={value}
            draggable
            onDragEnd={(e: any) => onChange(e.nativeEvent.coordinate)}
          />
        ) : null}
      </MapView>

      {!value ? (
        <View pointerEvents="none" style={styles.hint}>
          <MaterialCommunityIcons
            name="gesture-tap"
            size={16}
            color="#FFFFFF"
          />
          <Text style={styles.hintText}>Tap the map to drop a pin</Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hint: {
    position: "absolute",
    bottom: spacing.sm,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(20,20,20,0.7)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  hintText: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: "#FFFFFF",
  },
  fallback: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  fallbackText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    textAlign: "center",
  },
  });
}
