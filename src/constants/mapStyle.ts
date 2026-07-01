// src/constants/mapStyle.ts
// Custom Google Maps styling.
//
// MAP_STYLE_HIDE_BUSINESS_POIS hides Google's built-in *business* points of
// interest (restaurants, shops, etc. — their pins and labels) so the map shows
// only our own markers, without competing clutter. Parks, schools, transit and
// other non-business POIs are left visible.
//
// IMPORTANT: customMapStyle only affects Google Maps — i.e. Android with the
// default provider, or anywhere using PROVIDER_GOOGLE. Apple Maps (the iOS
// default) ignores it; there you must use the `showsPointsOfInterest={false}`
// prop instead (which hides *all* POIs — Apple has no per-category styling).
//
// To hide ALL POIs on Google Maps instead of only business ones, change
// featureType from "poi.business" to "poi".

export const MAP_STYLE_HIDE_BUSINESS_POIS = [
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }],
  },
];
