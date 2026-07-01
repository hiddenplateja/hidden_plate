// app/(tabs)/map.tsx
// Map View — full-screen map with restaurant markers.
//
// Markers (Uber Eats style):
//   - Single restaurant → a round black dot (brand colour + larger when selected).
//   - Nearby restaurants are CLUSTERED (supercluster) into a dark bubble showing
//     the count; tapping a cluster zooms in to expand it.
//   Each marker controls tracksViewChanges itself — tracking briefly so Android
//   captures the painted view, then stopping. (The old code snapshotted before
//   paint, which is why Android markers came out blank / not round.)
//
// Initial view priority:
//   1. User's location (if granted) → centered at city-level zoom
//   2. Average of restaurant locations → centered at city-level zoom
//   3. Fallback to Jamaica region (initialRegion)

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
import Supercluster from "supercluster";

import { MAP_STYLE_HIDE_BUSINESS_POIS } from "@/constants/mapStyle";
import { listRestaurants } from "@/services/restaurants";
import { getReviewStatsForRestaurants } from "@/services/reviews";
import { getImagePreviewUrl } from "@/services/storage";
import {
  fonts,
  radius,
  shadows,
  spacing,
  typographyTokens as T,
} from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import type { ThemeColors } from "@/theme/themes";
import { useThemedStyles } from "@/theme/useThemedStyles";
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

// ─── Map markers (Uber Eats-style dots + count clusters) ──────────────────────
// tracksViewChanges stays TRUE so Android LIVE-renders the marker view instead
// of snapshotting it to a bitmap — the snapshot was capturing a half-laid-out
// (clipped) view. Clustering keeps the number of on-screen markers small, so the
// extra render cost is fine. The marker child is also kept flat (no wrapper
// nesting) to avoid Android mis-measuring the bounds.

const DOT_BLACK = "#101010";

interface LatLng {
  latitude: number;
  longitude: number;
}

// Pick a category icon for a restaurant from its cuisines/categories.
function iconForRestaurant(
  r: Restaurant,
): keyof typeof MaterialCommunityIcons.glyphMap {
  const t = [...r.cuisines, ...r.categories].join(" ").toLowerCase();
  if (/jerk|bbq|barbecue|grill|smok/.test(t)) return "grill";
  if (/burger/.test(t)) return "hamburger";
  if (/seafood|fish|lobster|shrimp|crab/.test(t)) return "fish";
  if (/chicken|wing|fried/.test(t)) return "food-drumstick";
  if (/pizza/.test(t)) return "pizza";
  if (/patty|patties|bakery|bread|pastry|baked/.test(t)) return "food-croissant";
  if (/ital|vegan|vegetarian|salad|healthy/.test(t)) return "leaf";
  if (/sweet|dessert|cake|ice.?cream|gelato/.test(t)) return "cupcake";
  if (/coffee|cafe|espresso|tea/.test(t)) return "coffee";
  if (/bar|cocktail|drink|rum|beer/.test(t)) return "glass-cocktail";
  return "silverware-fork-knife";
}

// A single restaurant — a round black dot (brand-coloured + larger when selected).
function DotMarker({
  coordinate,
  icon,
  selected,
  onPress,
}: {
  coordinate: LatLng;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const size = selected ? 40 : 32;
  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View
        style={[
          markerStyles.dot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: selected ? colors.primary : DOT_BLACK,
          },
        ]}
      >
        <MaterialCommunityIcons
          name={icon}
          size={Math.round(size * 0.55)}
          color="#FFFFFF"
        />
      </View>
    </Marker>
  );
}

// A cluster of nearby restaurants — a white pill with a cutlery icon + count.
function ClusterMarker({
  coordinate,
  label,
  onPress,
}: {
  coordinate: LatLng;
  label: string;
  onPress: () => void;
}) {
  // A bigger version of the dot (which renders fine on Android) with the count
  // inside. Grows with the label so longer numbers stay centred.
  // iOS renders multi-child markers fine → use the white pill (cutlery + count).
  if (Platform.OS === "ios") {
    return (
      <Marker
        coordinate={coordinate}
        onPress={onPress}
        tracksViewChanges
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={markerStyles.clusterPill}>
          <MaterialCommunityIcons
            name="silverware-fork-knife"
            size={16}
            color={DOT_BLACK}
          />
          <Text style={markerStyles.clusterPillText}>{label}</Text>
        </View>
      </Marker>
    );
  }

  // Android — number-only black circle (pill / multi-child markers clip there).
  const size = label.length <= 2 ? 38 : label.length <= 3 ? 44 : 52;
  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
      tracksViewChanges
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View
        style={[
          markerStyles.cluster,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Text style={markerStyles.clusterText}>{label}</Text>
      </View>
    </Marker>
  );
}

const markerStyles = StyleSheet.create({
  // Single restaurant — a black circle with a category icon (no elevation;
  // Android clips elevated marker snapshots).
  dot: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  // Cluster — a bigger black circle with just the count.
  cluster: {
    backgroundColor: DOT_BLACK,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  clusterText: {
    color: "#FFFFFF",
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
  },
  // iOS cluster — white pill with a cutlery icon + count (from the design).
  clusterPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    ...shadows.md,
  },
  clusterPillText: {
    color: DOT_BLACK,
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    marginLeft: 5,
  },
});

// ─── Action Button ────────────────────────────────────────────────────────────
// Quick-action tile in the bottom sheet (icon + label) — mirrors the detail
// page's quick actions so the two screens feel of a piece.
function SheetTile({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { styles: sheetStyles, colors } = useThemedStyles(makeSheetStyles);
  return (
    <Pressable
      onPress={onPress}
      style={sheetStyles.tile}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <Text style={sheetStyles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

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
  const { styles: screenStyles, colors } = useThemedStyles(makeScreenStyles);
  const sheetStyles = useThemedStyles(makeSheetStyles).styles;
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
  // Current visible region — drives clustering (recomputed as the user pans/zooms).
  const [region, setRegion] = useState(JAMAICA_REGION);

  const snapPoints = useMemo(() => ["42%", "72%"], []);

  const restaurantById = useMemo(() => {
    const m = new Map<string, Restaurant>();
    for (const r of restaurants) m.set(r.id, r);
    return m;
  }, [restaurants]);

  // Build the cluster index from the restaurant points.
  const clusterIndex = useMemo(() => {
    const index = new Supercluster({ radius: 60, maxZoom: 16, minPoints: 2 });
    index.load(
      restaurants.map((r) => ({
        type: "Feature" as const,
        properties: { restaurantId: r.id },
        geometry: {
          type: "Point" as const,
          coordinates: [r.longitude, r.latitude] as [number, number],
        },
      })),
    );
    return index;
  }, [restaurants]);

  // Clusters / individual points visible in the current region + zoom.
  const clusters = useMemo(() => {
    const { longitude, latitude, longitudeDelta, latitudeDelta } = region;
    const bbox: [number, number, number, number] = [
      longitude - longitudeDelta / 2,
      latitude - latitudeDelta / 2,
      longitude + longitudeDelta / 2,
      latitude + latitudeDelta / 2,
    ];
    const zoom = Math.min(
      20,
      Math.max(0, Math.round(Math.log2(360 / longitudeDelta))),
    );
    try {
      return clusterIndex.getClusters(bbox, zoom);
    } catch {
      return [];
    }
  }, [clusterIndex, region]);

  // Tapping a cluster zooms to the level where it expands.
  const handleClusterPress = useCallback(
    (clusterId: number, lat: number, lng: number) => {
      try {
        const expansionZoom = Math.min(
          clusterIndex.getClusterExpansionZoom(clusterId),
          18,
        );
        const delta = 360 / Math.pow(2, expansionZoom);
        mapRef.current?.animateToRegion(
          {
            latitude: lat,
            longitude: lng,
            latitudeDelta: delta,
            longitudeDelta: delta,
          },
          400,
        );
      } catch {
        // ignore
      }
    },
    [clusterIndex],
  );

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

      // Merge LIVE review stats — the doc's averageRating/reviewCount are stale
      // (no Cloud Function maintains them), so the rating wouldn't show on the
      // bottom sheet otherwise. Best-effort: keep the doc values on failure.
      let items = page.items;
      try {
        const statsMap = await getReviewStatsForRestaurants(
          items.map((r) => r.id),
        );
        items = items.map((r) => {
          const s = statsMap.get(r.id);
          return s
            ? { ...r, averageRating: s.average, reviewCount: s.count }
            : r;
        });
      } catch (err) {
        console.warn("[map] failed to load review stats:", err);
      }

      if (cancelled) return;

      setRestaurants(items);
      if (loc) setUserLocation(loc);
      setIsLoading(false);

      // Set the initial view once. Brief delay so the map ref is mounted.
      if (!hasSetInitialViewRef.current) {
        hasSetInitialViewRef.current = true;
        setTimeout(() => {
          if (!cancelled) setInitialView(items, loc);
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
          name="map-marker-off"
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
        customMapStyle={MAP_STYLE_HIDE_BUSINESS_POIS}
        showsPointsOfInterest={false}
        initialRegion={JAMAICA_REGION}
        onRegionChangeComplete={(r: typeof JAMAICA_REGION) => setRegion(r)}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {clusters.map((c) => {
          const [lng, lat] = c.geometry.coordinates;
          const props = c.properties;
          if (props.cluster) {
            return (
              <ClusterMarker
                key={`cluster-${props.cluster_id}`}
                coordinate={{ latitude: lat, longitude: lng }}
                label={String(props.point_count_abbreviated)}
                onPress={() => handleClusterPress(props.cluster_id, lat, lng)}
              />
            );
          }
          const restaurant = restaurantById.get(props.restaurantId);
          if (!restaurant) return null;
          return (
            <DotMarker
              key={restaurant.id}
              coordinate={{ latitude: lat, longitude: lng }}
              icon={iconForRestaurant(restaurant)}
              selected={selectedRestaurant?.id === restaurant.id}
              onPress={() => handleMarkerPress(restaurant)}
            />
          );
        })}
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

              <Text style={sheetStyles.name} numberOfLines={2}>
                {selectedRestaurant.name}
              </Text>

              {/* Rating · price · cuisine */}
              <View style={sheetStyles.metaRow}>
                {selectedRestaurant.reviewCount > 0 ? (
                  <View style={sheetStyles.ratingPill}>
                    <MaterialCommunityIcons
                      name="star"
                      size={13}
                      color={colors.star}
                    />
                    <Text style={sheetStyles.ratingValue}>
                      {selectedRestaurant.averageRating.toFixed(1)}
                    </Text>
                    <Text style={sheetStyles.ratingCount}>
                      ({selectedRestaurant.reviewCount})
                    </Text>
                  </View>
                ) : (
                  <View style={sheetStyles.newPill}>
                    <Text style={sheetStyles.newPillText}>New</Text>
                  </View>
                )}
                {selectedRestaurant.priceRange ? (
                  <>
                    <Text style={sheetStyles.metaDot}>·</Text>
                    <Text style={sheetStyles.metaText}>
                      {selectedRestaurant.priceRange}
                    </Text>
                  </>
                ) : null}
                {selCuisine ? (
                  <>
                    <Text style={sheetStyles.metaDot}>·</Text>
                    <Text style={sheetStyles.metaText}>{selCuisine}</Text>
                  </>
                ) : null}
              </View>

              {selectedRestaurant.address ? (
                <View style={sheetStyles.infoRow}>
                  <MaterialCommunityIcons
                    name="map-marker-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={sheetStyles.infoText} numberOfLines={2}>
                    {selectedRestaurant.address}
                    {selParish ? `, ${selParish}` : ""}
                  </Text>
                </View>
              ) : null}

              {selectedRestaurant.description ? (
                <Text style={sheetStyles.description} numberOfLines={3}>
                  {selectedRestaurant.description}
                </Text>
              ) : null}

              {/* Quick actions */}
              <View style={sheetStyles.quickRow}>
                <SheetTile
                  icon="directions"
                  label="Directions"
                  onPress={() =>
                    openDirections(
                      selectedRestaurant.latitude,
                      selectedRestaurant.longitude,
                      selectedRestaurant.name,
                    )
                  }
                />
                {selectedRestaurant.phoneNumber ? (
                  <SheetTile
                    icon="phone"
                    label="Call"
                    onPress={() =>
                      Linking.openURL(`tel:${selectedRestaurant.phoneNumber}`)
                    }
                  />
                ) : null}
                {selectedRestaurant.websiteUrl ? (
                  <SheetTile
                    icon="web"
                    label="Website"
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

              {/* View details CTA */}
              <Pressable
                style={sheetStyles.viewBtn}
                onPress={() => {
                  bottomSheetRef.current?.close();
                  router.push(`/restaurant/${selectedRestaurant.id}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`View ${selectedRestaurant.name} details`}
              >
                <Text style={sheetStyles.viewBtnText}>View full details</Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={18}
                  color={colors.textInverse}
                />
              </Pressable>
            </Animated.View>
          ) : null}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeScreenStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
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
}

function makeSheetStyles(c: ThemeColors) {
  const colors = c;
  return StyleSheet.create({
  background: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
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
    height: 170,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  name: {
    fontFamily: fonts.black,
    fontSize: T.size.xxl,
    color: colors.textPrimary,
    letterSpacing: T.tracking.tight,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingValue: {
    fontFamily: fonts.bold,
    fontSize: T.size.sm,
    color: colors.textPrimary,
  },
  ratingCount: {
    fontFamily: fonts.regular,
    fontSize: T.size.xs,
    color: colors.textMuted,
  },
  newPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  newPillText: {
    fontFamily: fonts.bold,
    fontSize: T.size.xs,
    color: colors.textSecondary,
  },
  metaDot: { color: colors.textMuted, fontSize: T.size.sm },
  metaText: {
    fontFamily: fonts.medium,
    fontSize: T.size.sm,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: T.size.subDetail,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  description: {
    fontFamily: fonts.regular,
    fontSize: T.size.base,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  quickRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tile: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileLabel: {
    fontFamily: fonts.medium,
    fontSize: T.size.xs,
    color: colors.textPrimary,
  },
  viewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  viewBtnText: {
    fontFamily: fonts.bold,
    fontSize: T.size.base,
    color: colors.textInverse,
  },
  });
}
