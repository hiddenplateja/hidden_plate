// app/(tabs)/map.tsx
// Map View — full-screen map with restaurant markers.
//
// Marker strategy:
//   Android: SVG teardrop with restaurant photo inside (clean, no clipping bug)
//   iOS: circular photo marker with primary border
//
// Initial view priority:
//   1. User's location (if granted) → centered at city-level zoom
//   2. Average of restaurant locations → centered at city-level zoom
//   3. Fallback to Jamaica region (initialRegion)
//
// (Future: circle markers on Android via react-native-view-shot snapshot.
//  Deferred due to Windows symlink + Gradle 8 NDK build issue. Works fine
//  on Mac/Linux — revisit when build environment changes or via EAS.)

import { MaterialCommunityIcons } from "@expo/vector-icons";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { Image as ExpoImage } from "expo-image";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, G, Path } from "react-native-svg";

import { listRestaurants } from "@/services/restaurants";
import { getImagePreviewUrl } from "@/services/storage";
import {
  colors,
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import type { Parish, Restaurant } from "@/types/restaurant";

// ─── Conditional map import ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapView: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Marker: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PROVIDER_DEFAULT: any;

if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Maps = require("react-native-maps");
  MapView = Maps.default;
  Marker = Maps.Marker;
  PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
}

// ─── Parish labels ────────────────────────────────────────────────────────────
const PARISH_LABELS: Record<Parish, string> = {
  kingston: "Kingston",
  st_andrew: "St. Andrew",
  st_thomas: "St. Thomas",
  portland: "Portland",
  st_mary: "St. Mary",
  st_ann: "St. Ann",
  trelawny: "Trelawny",
  st_james: "St. James",
  hanover: "Hanover",
  westmoreland: "Westmoreland",
  st_elizabeth: "St. Elizabeth",
  manchester: "Manchester",
  clarendon: "Clarendon",
  st_catherine: "St. Catherine",
};

// ─── Marker dimensions ───────────────────────────────────────────────────────
const MARKER_SIZE = 50;
const BORDER_W = 3;
const TOTAL = MARKER_SIZE + BORDER_W * 2;

// ─── Android teardrop marker (SVG-based, no clipping bug) ─────────────────────
function AndroidMarker({
  isSelected,
  onReady,
}: {
  isSelected: boolean;
  onReady: () => void;
}) {
  useEffect(() => {
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = isSelected ? 52 : 44;
  const cx = d / 2;
  const r = cx - 2;
  const tip = d + d * 0.32;

  return (
    <Svg width={d} height={tip} viewBox={`0 0 ${d} ${tip}`}>
      <Circle
        cx={cx}
        cy={cx}
        r={r}
        fill={colors.primary}
        stroke={colors.cardBackground}
        strokeWidth={isSelected ? 3 : 2}
      />
      <Path
        d={`M ${cx - 5} ${d - 5} L ${cx} ${tip - 2} L ${cx + 5} ${d - 5} Z`}
        fill={colors.primary}
      />
      {/* Fork + knife icon */}
      <G transform={`translate(${cx - 6}, ${cx - 8})`}>
        <Path
          d="M2 0 L2 14 M0 0 L4 0 L4 5 Q2 7 0 5 L0 0"
          stroke={colors.cardBackground}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M10 0 Q14 3 14 6 L10 8 L10 14"
          stroke={colors.cardBackground}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
}

// ─── iOS circular photo marker ────────────────────────────────────────────────
function IOSMarker({
  imageUrl,
  isSelected,
  onReady,
}: {
  imageUrl: string | null;
  isSelected: boolean;
  onReady: () => void;
}) {
  useEffect(() => {
    if (!imageUrl) onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const scale = isSelected ? 1.15 : 1;
  const total = TOTAL * scale;
  const inner = MARKER_SIZE * scale;

  return (
    <View
      style={{
        width: total,
        height: total,
        borderRadius: total / 2,
        borderWidth: BORDER_W,
        borderColor: colors.primary,
        backgroundColor: colors.primary,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.4,
        shadowRadius: 5,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {imageUrl ? (
        <ExpoImage
          source={{ uri: imageUrl }}
          style={{
            width: inner,
            height: inner,
            borderRadius: inner / 2,
          }}
          contentFit="cover"
          priority="high"
          cachePolicy="memory-disk"
          onLoad={() => onReady()}
          onError={() => onReady()}
        />
      ) : (
        <MaterialCommunityIcons
          name="silverware-fork-knife"
          size={22}
          color={colors.cardBackground}
        />
      )}
    </View>
  );
}

function RestaurantMarker({
  imageUrl,
  isSelected,
  onReady,
}: {
  imageUrl: string | null;
  isSelected: boolean;
  onReady: () => void;
}) {
  if (Platform.OS === "android") {
    return <AndroidMarker isSelected={isSelected} onReady={onReady} />;
  }
  return (
    <IOSMarker imageUrl={imageUrl} isSelected={isSelected} onReady={onReady} />
  );
}

// ─── Action Button ────────────────────────────────────────────────────────────
function ActionButton({
  icon,
  label,
  onPress,
  variant = "outline",
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label?: string;
  onPress: () => void;
  variant?: "filled" | "outline";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        actionStyles.btn,
        variant === "filled" ? actionStyles.btnFilled : actionStyles.btnOutline,
        !label && actionStyles.btnIcon,
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={18}
        color={variant === "filled" ? colors.cardBackground : colors.primary}
      />
      {label ? (
        <Text
          style={[
            actionStyles.label,
            variant === "filled" && actionStyles.labelFilled,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const actionStyles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  btnFilled: {
    backgroundColor: colors.primary,
    flex: 1,
    ...shadows.sm,
  },
  btnOutline: {
    backgroundColor: colors.pageBackground,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
  },
  btnIcon: { paddingHorizontal: 14 },
  label: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.primary,
  },
  labelFilled: { color: colors.cardBackground },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

// Fallback region (whole Jamaica) — only used if everything else fails
const JAMAICA_REGION = {
  latitude: 18.1096,
  longitude: -77.2975,
  latitudeDelta: 1.2,
  longitudeDelta: 1.4,
};

// City-level zoom — shows roughly 9km of vertical area, good for a typical city
const CITY_DELTA = 0.08;

export default function MapScreen() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const hasSetInitialViewRef = useRef(false);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] =
    useState<Restaurant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] =
    useState<Location.LocationObject | null>(null);
  const [loadedMarkerIds, setLoadedMarkerIds] = useState<Set<string>>(
    new Set(),
  );

  const snapPoints = useMemo(() => ["42%", "72%"], []);

  // Decide what initial view to show. Priority order:
  //   1. User's location (if granted) → centered at city-level zoom
  //   2. Average of restaurant locations → centered at city-level zoom
  //   3. Fallback to Jamaica region (already initialRegion)
  const setInitialView = useCallback(
    (items: Restaurant[], loc: Location.LocationObject | null) => {
      if (!mapRef.current) return;

      if (loc) {
        mapRef.current.animateToRegion(
          {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: CITY_DELTA,
            longitudeDelta: CITY_DELTA,
          },
          800,
        );
        return;
      }

      if (items.length === 0) return;

      if (items.length === 1) {
        mapRef.current.animateToRegion(
          {
            latitude: items[0].latitude,
            longitude: items[0].longitude,
            latitudeDelta: CITY_DELTA,
            longitudeDelta: CITY_DELTA,
          },
          800,
        );
        return;
      }

      // Multiple restaurants, no user location — center on their average
      const avgLat =
        items.reduce((sum, r) => sum + r.latitude, 0) / items.length;
      const avgLng =
        items.reduce((sum, r) => sum + r.longitude, 0) / items.length;
      mapRef.current.animateToRegion(
        {
          latitude: avgLat,
          longitude: avgLng,
          latitudeDelta: CITY_DELTA,
          longitudeDelta: CITY_DELTA,
        },
        800,
      );
    },
    [],
  );

  // Load restaurants AND user location in parallel, then decide initial view.
  // We only animate to the initial position once — on first load. After that
  // the user is free to pan/zoom without us fighting them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Kick off both requests in parallel
      const [page, loc] = await Promise.all([
        // Restaurants
        (async () => {
          try {
            return await listRestaurants({ pageSize: 100, sort: "recent" });
          } catch (err) {
            console.warn("[map] failed to load restaurants:", err);
            return { items: [] as Restaurant[] };
          }
        })(),
        // User location (best-effort)
        (async () => {
          try {
            const { status } =
              await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") return null;
            return await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
          } catch {
            return null;
          }
        })(),
      ]);

      if (cancelled) return;

      setRestaurants(page.items);
      if (loc) setUserLocation(loc);
      setIsLoading(false);

      // Set the initial view once. Brief delay so the map ref is mounted.
      if (!hasSetInitialViewRef.current) {
        hasSetInitialViewRef.current = true;
        setTimeout(() => {
          if (!cancelled) setInitialView(page.items, loc);
        }, 400);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setInitialView]);

  const handleMarkerPress = useCallback((restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    mapRef.current?.animateToRegion(
      {
        latitude: restaurant.latitude - 0.008,
        longitude: restaurant.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      },
      500,
    );
    bottomSheetRef.current?.expand();
  }, []);

  const centerOnUser = useCallback(() => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: userLocation.coords.latitude,
          longitude: userLocation.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        800,
      );
    }
  }, [userLocation]);

  const handleMarkerReady = useCallback((restaurantId: string) => {
    setLoadedMarkerIds((prev) => {
      if (prev.has(restaurantId)) return prev;
      const next = new Set(prev);
      next.add(restaurantId);
      return next;
    });
  }, []);

  const openDirections = useCallback(
    (lat: number, lng: number, name: string) => {
      const encoded = encodeURIComponent(name);
      const url = Platform.select({
        ios: `maps://0,0?q=${encoded}@${lat},${lng}`,
        default: `geo:0,0?q=${lat},${lng}(${encoded})`,
      });
      Linking.openURL(url!).catch(() => {
        Linking.openURL(
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
        );
      });
    },
    [],
  );

  if (Platform.OS === "web") {
    return (
      <SafeAreaView style={screenStyles.center} edges={["top"]}>
        <MaterialCommunityIcons
          name="map-off"
          size={48}
          color={colors.textMuted}
        />
        <Text style={screenStyles.webFallback}>
          Map view is only available in the mobile app
        </Text>
      </SafeAreaView>
    );
  }

  const coverUrl = (r: Restaurant): string | null => {
    const fileId = r.coverImageId ?? r.imageIds[0] ?? null;
    return fileId ? getImagePreviewUrl(fileId) : null;
  };

  const selCuisine = selectedRestaurant?.cuisines[0] ?? null;
  const selParish = selectedRestaurant
    ? (PARISH_LABELS[selectedRestaurant.parish] ?? selectedRestaurant.parish)
    : null;
  const selCover = selectedRestaurant ? coverUrl(selectedRestaurant) : null;

  return (
    <View style={screenStyles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        initialRegion={JAMAICA_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {restaurants.map((restaurant) => (
          <Marker
            key={restaurant.id}
            coordinate={{
              latitude: restaurant.latitude,
              longitude: restaurant.longitude,
            }}
            onPress={() => handleMarkerPress(restaurant)}
            tracksViewChanges={!loadedMarkerIds.has(restaurant.id)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <RestaurantMarker
              imageUrl={coverUrl(restaurant)}
              isSelected={selectedRestaurant?.id === restaurant.id}
              onReady={() => handleMarkerReady(restaurant.id)}
            />
          </Marker>
        ))}
      </MapView>

      <SafeAreaView
        edges={["top"]}
        style={screenStyles.headerWrap}
        pointerEvents="box-none"
      >
        <View style={screenStyles.headerPill}>
          <MaterialCommunityIcons
            name="map-search"
            size={18}
            color={colors.primary}
          />
          <Text style={screenStyles.headerTitle}>Map View</Text>
          {isLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={{ marginLeft: "auto" }}
            />
          ) : (
            <Text style={screenStyles.headerCount}>
              {restaurants.length} {restaurants.length === 1 ? "spot" : "spots"}
            </Text>
          )}
        </View>
      </SafeAreaView>

      {userLocation ? (
        <Pressable
          style={screenStyles.locationFab}
          onPress={centerOnUser}
          accessibilityRole="button"
          accessibilityLabel="Center map on my location"
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={22}
            color={colors.primary}
          />
        </Pressable>
      ) : null}

      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={() => setSelectedRestaurant(null)}
        backgroundStyle={sheetStyles.background}
        handleIndicatorStyle={sheetStyles.handle}
      >
        <BottomSheetView style={sheetStyles.content}>
          {selectedRestaurant ? (
            <Animated.View entering={FadeInDown.springify()}>
              {selCover ? (
                <ExpoImage
                  source={{ uri: selCover }}
                  style={sheetStyles.image}
                  contentFit="cover"
                  transition={300}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[sheetStyles.image, sheetStyles.imagePlaceholder]}>
                  <MaterialCommunityIcons
                    name="silverware-fork-knife"
                    size={36}
                    color={colors.border}
                  />
                </View>
              )}

              <Pressable
                style={sheetStyles.nameRow}
                onPress={() => {
                  bottomSheetRef.current?.close();
                  router.push(`/restaurant/${selectedRestaurant.id}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`View ${selectedRestaurant.name} details`}
              >
                <Text style={sheetStyles.name} numberOfLines={1}>
                  {selectedRestaurant.name}
                </Text>
                <View style={sheetStyles.viewBtn}>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={18}
                    color={colors.primary}
                  />
                </View>
              </Pressable>

              <View style={sheetStyles.tagRow}>
                {selCuisine ? (
                  <View style={sheetStyles.tag}>
                    <Text style={sheetStyles.tagText}>{selCuisine}</Text>
                  </View>
                ) : null}
                {selParish ? (
                  <View style={sheetStyles.tagOutline}>
                    <MaterialCommunityIcons
                      name="map-marker"
                      size={12}
                      color={colors.textMuted}
                    />
                    <Text style={sheetStyles.tagOutlineText}>{selParish}</Text>
                  </View>
                ) : null}
                {selectedRestaurant.reviewCount > 0 ? (
                  <View style={sheetStyles.tagOutline}>
                    <MaterialCommunityIcons
                      name="star"
                      size={12}
                      color={colors.star}
                    />
                    <Text style={sheetStyles.tagOutlineText}>
                      {selectedRestaurant.averageRating.toFixed(1)} (
                      {selectedRestaurant.reviewCount})
                    </Text>
                  </View>
                ) : null}
              </View>

              {selectedRestaurant.address ? (
                <View style={sheetStyles.infoRow}>
                  <MaterialCommunityIcons
                    name="map-marker-outline"
                    size={15}
                    color={colors.textMuted}
                  />
                  <Text style={sheetStyles.infoText} numberOfLines={2}>
                    {selectedRestaurant.address}
                  </Text>
                </View>
              ) : null}

              {selectedRestaurant.description ? (
                <Text style={sheetStyles.description} numberOfLines={3}>
                  {selectedRestaurant.description}
                </Text>
              ) : null}

              <View style={sheetStyles.actionRow}>
                <ActionButton
                  icon="directions"
                  label="Get Directions"
                  variant="filled"
                  onPress={() =>
                    openDirections(
                      selectedRestaurant.latitude,
                      selectedRestaurant.longitude,
                      selectedRestaurant.name,
                    )
                  }
                />
                {selectedRestaurant.phoneNumber ? (
                  <ActionButton
                    icon="phone"
                    variant="outline"
                    onPress={() =>
                      Linking.openURL(`tel:${selectedRestaurant.phoneNumber}`)
                    }
                  />
                ) : null}
                {selectedRestaurant.websiteUrl ? (
                  <ActionButton
                    icon="earth"
                    variant="outline"
                    onPress={() => {
                      const url = selectedRestaurant.websiteUrl ?? "";
                      const full = url.startsWith("http")
                        ? url
                        : `https://${url}`;
                      Linking.openURL(full).catch(() => {});
                    }}
                  />
                ) : null}
              </View>
            </Animated.View>
          ) : null}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const screenStyles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.pageBackground,
    gap: spacing.md,
  },
  webFallback: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.screen,
    marginTop: spacing.md,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.md,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
  },
  headerCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    marginLeft: "auto",
  },
  locationFab: {
    position: "absolute",
    right: spacing.screen,
    bottom: 96,
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.cardBackground,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.divider,
    ...shadows.md,
  },
});

const sheetStyles = StyleSheet.create({
  background: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.divider,
    borderRadius: radius.full,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  image: {
    width: "100%",
    height: 180,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    backgroundColor: colors.pageBackground,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  name: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    flex: 1,
  },
  viewBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary,
    marginLeft: spacing.sm,
  },
  tagRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xl,
    flexWrap: "wrap",
  },
  tag: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  tagText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.primary,
    letterSpacing: T.tracking.wider,
    textTransform: "capitalize",
  },
  tagOutline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.pageBackground,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  tagOutlineText: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginBottom: spacing.sm,
  },
  infoText: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textMuted,
    flex: 1,
    lineHeight: T.leading.normal,
  },
  description: {
    fontFamily: fonts.regular,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    lineHeight: T.leading.normal,
    marginBottom: spacing.lg,
  },
});
