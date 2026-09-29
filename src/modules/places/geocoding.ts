// Place search / reverse geocoding behind an interface so the implementation can be swapped without touching
// callers. Two implementations today:
//   - DbGeocodingProvider (default, GEOCODING_PROVIDER=db) — the seeded `places_catalog` table. Free, no
//     network dependency, coverage limited to the seed data.
//   - GoogleGeocodingProvider (GEOCODING_PROVIDER=google, see ./googleGeocoding.ts) — real Google Places
//     Text Search + Geocoding API. Near-total Nigerian coverage, costs per request, needs
//     GOOGLE_MAPS_SERVER_API_KEY.
// getGeocodingProvider() below picks between them based on env.geocodingProvider (src/config/env.ts, which
// documents the full tradeoff). Other options considered for later: Mapbox Search/Geocoding (cheaper,
// decent Lagos coverage, permissive caching terms), HERE (good routing bundle), or self-hosted
// Nominatim/Photon on OpenStreetMap (free, weakest street-level Nigerian data).
import { db } from "@/db/knex";
import { distanceKm } from "@/common/utils/geo";
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import { GoogleGeocodingProvider } from "./googleGeocoding";

export interface GeoPlace {
  id: string;
  label: string;
  subtitle: string;
  lat: number;
  lng: number;
  kind: "search";
}

export interface GeocodingProvider {
  search(query: string, opts?: { near?: { lat: number; lng: number }; limit?: number }): Promise<GeoPlace[]>;
  reverse(lat: number, lng: number): Promise<GeoPlace | null>;
}

function toPlace(r: any): GeoPlace {
  return { id: r.id, label: r.label, subtitle: r.subtitle ?? "", lat: Number(r.lat), lng: Number(r.lng), kind: "search" };
}

function escapeLike(s: string): string {
  return s.replace(/[\%_]/g, (m) => `\${m}`);
}

export class DbGeocodingProvider implements GeocodingProvider {
  async search(query: string, opts: { near?: { lat: number; lng: number }; limit?: number } = {}): Promise<GeoPlace[]> {
    const q = query.trim();
    const limit = Math.min(opts.limit ?? 8, 20);
    if (q.length < 2) return [];
    const like = `%${escapeLike(q.toLowerCase())}%`;
    const rows = await db("places_catalog")
      .whereRaw("lower(label) like ?", [like])
      .orWhereRaw("lower(coalesce(subtitle,'')) like ?", [like])
      .orWhereRaw("lower(coalesce(aliases,'')) like ?", [like])
      .limit(100);
    const lower = q.toLowerCase();
    const ranked = rows
      .map((r) => {
        const label = String(r.label).toLowerCase();
        const score = label === lower ? 0 : label.startsWith(lower) ? 1 : label.includes(lower) ? 2 : 3;
        const dist = opts.near ? distanceKm(opts.near.lat, opts.near.lng, Number(r.lat), Number(r.lng)) : 0;
        return { r, score, dist };
      })
      .sort((a, b) => a.score - b.score || a.dist - b.dist || String(a.r.label).localeCompare(String(b.r.label)));
    return ranked.slice(0, limit).map((x) => toPlace(x.r));
  }

  async reverse(lat: number, lng: number): Promise<GeoPlace | null> {
    const rows = await db("places_catalog").select("*");
    let best: { r: any; d: number } | null = null;
    for (const r of rows) {
      const d = distanceKm(lat, lng, Number(r.lat), Number(r.lng));
      if (!best || d < best.d) best = { r, d };
    }
    return best && best.d <= 1.5 ? toPlace(best.r) : null; // only "near" matches; otherwise the client shows raw coordinates
  }
}

/** Pure selection logic (no caching) — kept separate from getGeocodingProvider() so tests can exercise it
 *  repeatedly under different env.geocodingProvider values without process restarts. */
export function createGeocodingProvider(): GeocodingProvider {
  if (env.geocodingProvider === "google") {
    if (!env.googleMaps.serverApiKey) {
      logger.warn("GEOCODING_PROVIDER=google but GOOGLE_MAPS_SERVER_API_KEY is not set — falling back to DbGeocodingProvider");
      return new DbGeocodingProvider();
    }
    return new GoogleGeocodingProvider();
  }
  return new DbGeocodingProvider();
}

let provider: GeocodingProvider | undefined;
export function getGeocodingProvider(): GeocodingProvider {
  if (!provider) provider = createGeocodingProvider();
  return provider;
}

/** Test-only: clears the cached singleton so the next getGeocodingProvider() call re-reads env.geocodingProvider. */
export function _resetGeocodingProviderForTests(): void {
  provider = undefined;
}
