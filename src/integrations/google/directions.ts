// Google Directions adapter — road distance + ETA for trip fare/quote calculations.
//
// IMPORTANT: the GOOGLE_MAPS_SERVER_API_KEY configured today (see .env / src/config/env.ts) has Maps
// JavaScript API, Places API and Geocoding API enabled, but NOT Directions API (or the newer Routes API).
// Calls here will therefore currently return REQUEST_DENIED / HTTP 403 until one of those is enabled in
// Google Cloud Console:
//   - Directions API: https://console.cloud.google.com/apis/library/directions-backend.googleapis.com
//   - Routes API (newer, recommended by Google going forward):
//     https://console.cloud.google.com/apis/library/routes.googleapis.com
// That is expected, not a bug: getRoadDistance() below never throws — any failure (HTTP error, non-OK
// Google status, network error, missing key) is logged and resolved as `null`, exactly like the
// Monnify/Resend/Termii adapters fall back to mock behaviour when they are not in "live" mode. The caller
// (`resolveDistanceKm` in src/modules/trips/trips.service.ts) falls back to the existing haversine
// straight-line estimate whenever this returns `null`.
//
// Only used when GEOCODING_PROVIDER=google (see env.ts's `geocodingProvider` doc comment for why that one
// flag gates both geocoding and this).
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";

export interface RoadDistanceResult {
  distanceKm: number;
  etaMinutes: number;
  /** Encoded polyline (Directions API `overview_polyline.points`) for the route, when Google returns one.
   *  Not yet persisted anywhere (would need a new `trips` column + migration) — a follow-up, not wired into
   *  the trip DTO here. Kept on this return value so a caller that wants it later doesn't need a new API call. */
  polyline?: string;
}

interface LatLng {
  lat: number;
  lng: number;
}

const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

/**
 * Real road distance (km) + ETA (minutes) between two points via Google Directions, driving mode,
 * biased to Nigeria. Returns `null` on any failure instead of throwing — callers must have a fallback.
 */
export async function getRoadDistance(origin: LatLng, destination: LatLng): Promise<RoadDistanceResult | null> {
  if (!env.googleMaps.serverApiKey) {
    logger.warn("[google:directions] GOOGLE_MAPS_SERVER_API_KEY not set, skipping — falling back to haversine distance");
    return null;
  }
  try {
    const url = new URL(DIRECTIONS_URL);
    url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
    url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("region", "ng");
    url.searchParams.set("key", env.googleMaps.serverApiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      // Expected today: 403 — Directions API is not enabled on this key yet. Never thrown, just logged.
      logger.warn({ httpStatus: res.status }, "[google:directions] HTTP error — falling back to haversine distance");
      return null;
    }
    const body = (await res.json()) as any;
    if (body.status !== "OK") {
      // Expected today: REQUEST_DENIED. Also covers ZERO_RESULTS, OVER_QUERY_LIMIT, INVALID_REQUEST, etc.
      logger.warn(
        { googleStatus: body.status, errorMessage: body.error_message },
        "[google:directions] API returned a non-OK status — falling back to haversine distance"
      );
      return null;
    }
    const route = body.routes?.[0];
    const leg = route?.legs?.[0];
    if (!leg) {
      logger.warn("[google:directions] OK response had no route/leg — falling back to haversine distance");
      return null;
    }
    return {
      distanceKm: Math.round((leg.distance.value / 1000) * 100) / 100,
      etaMinutes: Math.round(leg.duration.value / 60),
      polyline: route.overview_polyline?.points,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[google:directions] request failed — falling back to haversine distance");
    return null;
  }
}
