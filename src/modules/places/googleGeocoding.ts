// GoogleGeocodingProvider — real Google-backed place search / reverse geocoding.
//
// Uses the Places API (Text Search) for `search()` and the Geocoding API for `reverse()`. Both are
// enabled on GOOGLE_MAPS_SERVER_API_KEY today (unlike Directions/Routes — see
// src/integrations/google/directions.ts, which the current key does NOT have enabled). Results are biased
// toward Lagos, Nigeria by default; the caller's `near` option (when supplied) overrides that centre.
//
// Tradeoff vs DbGeocodingProvider (kept for reference; see geocoding.ts's own top-of-file comparison too):
// real, current, near-total Nigerian address/POI coverage, but costs per request (Places Text Search is
// billed per call) and needs outbound network access from the API server. DbGeocodingProvider — free,
// zero network dependency, but only as good as the seeded `places_catalog` — stays the default
// (GEOCODING_PROVIDER=db); this class only gets used when the user explicitly opts in.
//
// Errors are handled the same way as the other "live" integrations in this codebase (Monnify/Resend/
// Termii): logged, never thrown, degrading to an empty result rather than a 500.
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import { distanceKm } from "@/common/utils/geo";
import type { GeocodingProvider, GeoPlace } from "./geocoding";

const LAGOS = { lat: 6.5244, lng: 3.3792 };
const TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

function toPlaceFromTextSearch(r: any): GeoPlace {
  return {
    id: r.place_id,
    label: r.name ?? r.formatted_address ?? "",
    subtitle: r.formatted_address ?? "",
    lat: Number(r.geometry?.location?.lat),
    lng: Number(r.geometry?.location?.lng),
    kind: "search",
  };
}

function toPlaceFromGeocode(r: any): GeoPlace {
  // address_components[0] is usually the street number/name; skip it and take the next couple of
  // components (locality/area, state) for a short human subtitle, mirroring DbGeocodingProvider's shape.
  const subtitleParts = (r.address_components ?? []).slice(1, 3).map((c: any) => c.long_name);
  return {
    id: r.place_id,
    label: r.formatted_address ?? "",
    subtitle: subtitleParts.join(", "),
    lat: Number(r.geometry?.location?.lat),
    lng: Number(r.geometry?.location?.lng),
    kind: "search",
  };
}

export class GoogleGeocodingProvider implements GeocodingProvider {
  async search(query: string, opts: { near?: { lat: number; lng: number }; limit?: number } = {}): Promise<GeoPlace[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    if (!env.googleMaps.serverApiKey) {
      logger.warn("[google:places] GOOGLE_MAPS_SERVER_API_KEY not set, search returning no results");
      return [];
    }
    const limit = Math.min(opts.limit ?? 8, 20);
    const near = opts.near ?? LAGOS;
    try {
      const url = new URL(TEXT_SEARCH_URL);
      url.searchParams.set("query", q);
      url.searchParams.set("location", `${near.lat},${near.lng}`);
      url.searchParams.set("radius", "50000"); // 50km bias — Places Text Search treats this as a ranking hint, not a hard filter
      url.searchParams.set("region", "ng");
      url.searchParams.set("key", env.googleMaps.serverApiKey);

      const res = await fetch(url.toString());
      if (!res.ok) {
        logger.warn({ httpStatus: res.status }, "[google:places] search HTTP error");
        return [];
      }
      const body = (await res.json()) as any;
      if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
        logger.warn({ googleStatus: body.status, errorMessage: body.error_message }, "[google:places] search returned a non-OK status");
        return [];
      }
      const results = (body.results ?? []) as any[];
      const ranked = results
        .filter((r) => r.geometry?.location)
        .map((r) => ({ r, dist: distanceKm(near.lat, near.lng, Number(r.geometry.location.lat), Number(r.geometry.location.lng)) }))
        .sort((a, b) => a.dist - b.dist);
      return ranked.slice(0, limit).map((x) => toPlaceFromTextSearch(x.r));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[google:places] search request failed");
      return [];
    }
  }

  async reverse(lat: number, lng: number): Promise<GeoPlace | null> {
    if (!env.googleMaps.serverApiKey) {
      logger.warn("[google:places] GOOGLE_MAPS_SERVER_API_KEY not set, reverse returning null");
      return null;
    }
    try {
      const url = new URL(GEOCODE_URL);
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("region", "ng");
      url.searchParams.set("key", env.googleMaps.serverApiKey);

      const res = await fetch(url.toString());
      if (!res.ok) {
        logger.warn({ httpStatus: res.status }, "[google:places] reverse HTTP error");
        return null;
      }
      const body = (await res.json()) as any;
      if (body.status !== "OK") {
        if (body.status !== "ZERO_RESULTS") {
          logger.warn({ googleStatus: body.status, errorMessage: body.error_message }, "[google:places] reverse returned a non-OK status");
        }
        return null;
      }
      const first = (body.results ?? [])[0];
      return first ? toPlaceFromGeocode(first) : null;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[google:places] reverse request failed");
      return null;
    }
  }
}
