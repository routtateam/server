import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { distanceKm } from "@/common/utils/geo";
import {
  DbGeocodingProvider,
  createGeocodingProvider,
  _resetGeocodingProviderForTests,
} from "@/modules/places/geocoding";
import { GoogleGeocodingProvider } from "@/modules/places/googleGeocoding";
import { getRoadDistance } from "@/integrations/google/directions";
import { tripsService } from "@/modules/trips/trips.service";

const ORIGINAL_PROVIDER = env.geocodingProvider;
const ORIGINAL_KEY = env.googleMaps.serverApiKey;

function restoreEnv() {
  env.geocodingProvider = ORIGINAL_PROVIDER;
  env.googleMaps.serverApiKey = ORIGINAL_KEY;
  _resetGeocodingProviderForTests();
}

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

describe("getGeocodingProvider() / createGeocodingProvider() selection", () => {
  it("defaults to DbGeocodingProvider when GEOCODING_PROVIDER is unset/db", () => {
    env.geocodingProvider = "db";
    expect(createGeocodingProvider()).toBeInstanceOf(DbGeocodingProvider);
  });

  it("picks GoogleGeocodingProvider when GEOCODING_PROVIDER=google and a key is present", () => {
    env.geocodingProvider = "google";
    env.googleMaps.serverApiKey = "test-key";
    expect(createGeocodingProvider()).toBeInstanceOf(GoogleGeocodingProvider);
  });

  it("falls back to DbGeocodingProvider when GEOCODING_PROVIDER=google but no key is configured", () => {
    env.geocodingProvider = "google";
    env.googleMaps.serverApiKey = "";
    expect(createGeocodingProvider()).toBeInstanceOf(DbGeocodingProvider);
  });
});

describe("GoogleGeocodingProvider", () => {
  beforeEach(() => {
    env.googleMaps.serverApiKey = "test-key";
  });

  it("search() maps a successful Places Text Search response to GeoPlace[]", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            place_id: "abc123",
            name: "Ikeja City Mall",
            formatted_address: "Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos",
            geometry: { location: { lat: 6.6018, lng: 3.3515 } },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GoogleGeocodingProvider();
    const results = await provider.search("Ikeja City Mall", { near: { lat: 6.5244, lng: 3.3792 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("place/textsearch/json");
    expect(calledUrl).not.toContain("test-key%3A"); // sanity: key isn't double-encoded/mangled
    expect(results).toEqual([
      { id: "abc123", label: "Ikeja City Mall", subtitle: "Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", lat: 6.6018, lng: 3.3515, kind: "search" },
    ]);
  });

  it("search() returns [] (not a throw) on a non-OK Google status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "REQUEST_DENIED", error_message: "Places API not enabled" }) }));
    const results = await new GoogleGeocodingProvider().search("anywhere");
    expect(results).toEqual([]);
  });

  it("search() returns [] (not a throw) on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    const results = await new GoogleGeocodingProvider().search("anywhere");
    expect(results).toEqual([]);
  });

  it("search() returns [] (not a throw) on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const results = await new GoogleGeocodingProvider().search("anywhere");
    expect(results).toEqual([]);
  });

  it("reverse() maps a successful Geocoding API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              place_id: "xyz789",
              formatted_address: "12 Admiralty Way, Lekki Phase 1, Lagos",
              address_components: [{ long_name: "12" }, { long_name: "Lekki Phase 1" }, { long_name: "Lagos" }],
              geometry: { location: { lat: 6.4406, lng: 3.4569 } },
            },
          ],
        }),
      })
    );
    const place = await new GoogleGeocodingProvider().reverse(6.4406, 3.4569);
    expect(place).toEqual({
      id: "xyz789",
      label: "12 Admiralty Way, Lekki Phase 1, Lagos",
      subtitle: "Lekki Phase 1, Lagos",
      lat: 6.4406,
      lng: 3.4569,
      kind: "search",
    });
  });

  it("reverse() returns null on ZERO_RESULTS, non-OK status, HTTP error, and network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) }));
    expect(await new GoogleGeocodingProvider().reverse(0, 0)).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "REQUEST_DENIED" }) }));
    expect(await new GoogleGeocodingProvider().reverse(0, 0)).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    expect(await new GoogleGeocodingProvider().reverse(0, 0)).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await new GoogleGeocodingProvider().reverse(0, 0)).toBeNull();
  });

  it("search()/reverse() return empty/null (no network call) when no API key is configured", async () => {
    env.googleMaps.serverApiKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await new GoogleGeocodingProvider().search("Ikeja")).toEqual([]);
    expect(await new GoogleGeocodingProvider().reverse(6.5, 3.4)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getRoadDistance() (Google Directions)", () => {
  beforeEach(() => {
    env.googleMaps.serverApiKey = "test-key";
  });

  const origin = { lat: 6.5244, lng: 3.3792 };
  const destination = { lat: 6.6018, lng: 3.3515 };

  it("parses a successful Directions response into distanceKm/etaMinutes/polyline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "OK",
          routes: [
            {
              overview_polyline: { points: "abc123encoded" },
              legs: [{ distance: { value: 12345 }, duration: { value: 900 } }],
            },
          ],
        }),
      })
    );
    const result = await getRoadDistance(origin, destination);
    expect(result).toEqual({ distanceKm: 12.35, etaMinutes: 15, polyline: "abc123encoded" });
  });

  it("returns null (this codebase's expected outcome) on REQUEST_DENIED — e.g. Directions API not enabled on the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "REQUEST_DENIED", error_message: "This API project is not authorized to use this API." }),
      })
    );
    expect(await getRoadDistance(origin, destination)).toBeNull();
  });

  it("returns null on an HTTP 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    expect(await getRoadDistance(origin, destination)).toBeNull();
  });

  it("returns null on a network failure, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(getRoadDistance(origin, destination)).resolves.toBeNull();
  });

  it("returns null (no network call) when no API key is configured", async () => {
    env.googleMaps.serverApiKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getRoadDistance(origin, destination)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trips.service quote distance falls back to haversine when Directions is unavailable", () => {
  const pickup = { lat: 6.5244, lng: 3.3792 };
  const destination = { lat: 6.6018, lng: 3.3515 };
  const haversine = distanceKm(pickup.lat, pickup.lng, destination.lat, destination.lng);

  it("GEOCODING_PROVIDER=db never calls Directions — quote distance is the haversine value", async () => {
    env.geocodingProvider = "db";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const quotes = await tripsService.getQuotes(pickup, destination);
    expect(quotes[0].distanceKm).toBe(haversine);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GEOCODING_PROVIDER=google + Directions REQUEST_DENIED falls back to the same haversine distance", async () => {
    env.geocodingProvider = "google";
    env.googleMaps.serverApiKey = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "REQUEST_DENIED" }) }));
    const quotes = await tripsService.getQuotes(pickup, destination);
    expect(quotes[0].distanceKm).toBe(haversine);
  });

  it("GEOCODING_PROVIDER=google + a successful Directions call uses the real road distance instead", async () => {
    env.geocodingProvider = "google";
    env.googleMaps.serverApiKey = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "OK", routes: [{ legs: [{ distance: { value: 9000 }, duration: { value: 600 } }] }] }),
      })
    );
    const quotes = await tripsService.getQuotes(pickup, destination);
    expect(quotes[0].distanceKm).toBe(9);
    expect(quotes[0].distanceKm).not.toBe(haversine);
  });
});
