// Centralised, typed environment configuration.
// Every var documented in `.env.example` is read here so the rest of the
// codebase never touches `process.env` directly.
import "dotenv/config";

function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV", "development") === "production",
  port: num("PORT", 4000),
  apiPrefix: str("API_PREFIX", "/api/v1"),
  corsOrigins: str("CORS_ORIGINS", "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    url: process.env.DATABASE_URL,
    host: str("DB_HOST", "localhost"),
    port: num("DB_PORT", 5432),
    user: str("DB_USER", "routta"),
    password: str("DB_PASSWORD", "routta"),
    name: str("DB_NAME", "routta_dev"),
    ssl: bool("DB_SSL", false),
    poolMin: num("DB_POOL_MIN", 2),
    poolMax: num("DB_POOL_MAX", 10),
  },

  redis: {
    url: process.env.REDIS_URL,
    host: str("REDIS_HOST", "localhost"),
    port: num("REDIS_PORT", 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: str("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
    refreshSecret: str("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
    accessTtl: str("JWT_ACCESS_TTL", "15m"),
    refreshTtl: str("JWT_REFRESH_TTL", "30d"),
  },

  otp: {
    ttlSeconds: num("OTP_TTL_SECONDS", 300),
    length: num("OTP_LENGTH", 6),
  },

  bcryptSaltRounds: num("BCRYPT_SALT_ROUNDS", 10),

  monnify: {
    liveMode: bool("MONNIFY_LIVE_MODE", false),
    baseUrl: str("MONNIFY_BASE_URL", "https://sandbox.monnify.com"),
    apiKey: str("MONNIFY_API_KEY", "MK_TEST_PLACEHOLDER"),
    secretKey: str("MONNIFY_SECRET_KEY", "PLACEHOLDER_SECRET"),
    contractCode: str("MONNIFY_CONTRACT_CODE", "0000000000"),
    webhookSecret: str("MONNIFY_WEBHOOK_SECRET", "dev-webhook-secret"),
  },

  resend: {
    liveMode: bool("RESEND_LIVE_MODE", false),
    apiKey: str("RESEND_API_KEY", "re_test_placeholder"),
    fromEmail: str("RESEND_FROM_EMAIL", "Routta <no-reply@routta.app>"),
  },

  termii: {
    liveMode: bool("TERMII_LIVE_MODE", false),
    baseUrl: str("TERMII_BASE_URL", "https://api.ng.termii.com"),
    apiKey: str("TERMII_API_KEY", "TL_TEST_PLACEHOLDER"),
    senderId: str("TERMII_SENDER_ID", "Routta"),
  },

  /** Background-job execution: "auto" = BullMQ when Redis is reachable, otherwise (non-production only) run inline;
   *  "queue" = always BullMQ; "inline" = always run inline (tests). */
  jobsMode: str("JOBS_MODE", "auto") as "auto" | "queue" | "inline",

  /** Fixed UTC offset (minutes) used for "today / this week" boundaries. Lagos = +60, no DST. */
  appUtcOffsetMinutes: num("APP_UTC_OFFSET_MINUTES", 60),

  /** Partner booking flow: hours a partner has to accept a requested booking before it expires. */
  bookingRequestTtlHours: num("BOOKING_REQUEST_TTL_HOURS", 12),

  /** Fee (kobo) charged when a commuter cancels after a driver has been on the way for > grace period. */
  cancelFeeKobo: num("CANCEL_FEE_KOBO", 30000),
  cancelFeeGraceSeconds: num("CANCEL_FEE_GRACE_SECONDS", 120),

  storage: {
    driver: str("STORAGE_DRIVER", "local") as "local",
    localDir: str("UPLOAD_DIR", "./uploads"),
    maxUploadBytes: num("MAX_UPLOAD_BYTES", 5 * 1024 * 1024),
  },

  verificationProvider: str("VERIFICATION_PROVIDER", "none"),

  googleMaps: {
    /** Server-side key. Currently has Maps JavaScript/Places/Geocoding enabled, NOT Directions/Routes
     *  (see src/integrations/google/directions.ts). Empty string when unset — callers must check for that
     *  rather than assume a key exists, since `str()` would otherwise throw on every boot. */
    serverApiKey: process.env.GOOGLE_MAPS_SERVER_API_KEY ?? "",
  },

  /**
   * Which GeocodingProvider `getGeocodingProvider()` (src/modules/places/geocoding.ts) hands out, and —
   * reusing the same flag rather than adding a second one — whether trip fare/quote distance tries Google
   * Directions for real road distance/ETA before falling back to the haversine estimate (see
   * `resolveDistanceKm` in trips.service.ts).
   *   "db"     (default) — DbGeocodingProvider over the seeded `places_catalog` table, haversine distance
   *             only. Free, no network dependency, no external quota/cost, but coverage is only as good as
   *             the seeded catalogue and distance is straight-line, not road distance.
   *   "google" — GoogleGeocodingProvider (real Places Text Search + Geocoding API — both enabled on the
   *             current key) for search/reverse, and Google Directions for fare distance/ETA (NOT enabled
   *             on the current key yet — every call gracefully falls back to haversine; see
   *             src/integrations/google/directions.ts). Costs per request once Directions is enabled and
   *             needs GOOGLE_MAPS_SERVER_API_KEY. Left as an explicit opt-in — default stays "db" so
   *             existing behaviour/tests are undisturbed until the user decides to flip it.
   */
  geocodingProvider: str("GEOCODING_PROVIDER", "db") as "db" | "google",

  logLevel: str("LOG_LEVEL", "info"),
};
