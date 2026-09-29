# Routta Backend

Modular-monolith backend for Routta (ride-hailing + premium business rentals),
built to match the API surface the four existing frontends
(`commuter-mobile`, `transporter-mobile`, `web-ui`, `pb-mobile`) already
assume in their `src/services/*` mock layers.

Stack: **Node.js + Express + TypeScript**, **PostgreSQL via Knex**
(query builder + migrations + seeds), **BullMQ + Redis** for background
jobs, JWT-based auth with **RBAC**, versioned REST API under `/api/v1`.

## Architecture

- **Modular monolith, feature-based.** Each domain lives under
  `src/modules/<name>` and owns its own `*.routes.ts` (Express routes),
  `*.controller.ts` (HTTP glue), `*.service.ts` (business logic),
  `*.repository.ts` (Knex queries), and `*.validation.ts` (zod schemas).
- **API Gateway pattern, in-process.** `src/routes.ts` is the single place
  that mounts every module's router under its path segment; `src/app.ts`
  mounts that whole router once at `/api/v1`. This is a lightweight
  gateway seam, not a separate service — intentionally, per the project's
  "modular monolith, not microservices" architecture decision.
- **Event-driven internals.** `src/events/eventBus.ts` is an in-process
  `EventEmitter`-based bus for domain events (`trip.completed`,
  `payment.succeeded`, `driver.verification.submitted`, …). Modules publish
  events instead of importing each other directly; `src/jobs/index.ts`
  subscribes to the events that should enqueue a background job.
- **Async workers via BullMQ + Redis, with a dev fallback.** `src/jobs/queues/*`
  define typed (lazily created) queues; `src/jobs/processors/*` hold the job
  logic; `src/jobs/workers/index.ts` is a **separate process entrypoint**
  (`npm run worker`) that consumes them. Producers never touch queues
  directly: they call `src/jobs/dispatch.ts` (`dispatchTripSettlement`,
  `dispatchNotification`, `dispatchPayout`). With Redis reachable the work is
  enqueued; when it is not (and `NODE_ENV !== production`, `JOBS_MODE=auto`)
  the **same processor function runs inline**, so local dev and tests do not
  need Redis. In production the fallback is disabled. Every processor is
  idempotent (see "Trip completion & earnings" below).
- **RBAC.** `src/modules/rbac/permissions.ts` mirrors
  `web-ui/src/types/index.ts`'s `Permission` union and default role→permission
  map exactly, so the server enforces the same permissions the admin
  dashboard's `<RequirePermission>` component gates in the UI.
  `src/common/middleware/rbac.ts` (`requirePermission`) is the real
  enforcement boundary; the client-side gate is UX only.

### Module map

| Module | Covers |
|---|---|
| `auth` | Commuter/driver phone+OTP signup & login, staff (admin) email+password+MFA login, premium-business partner login, JWT issue/refresh |
| `users` | Commuter profile, saved places, emergency contacts |
| `drivers` | Driver profile, vehicle, documents/verification status, earnings, payouts, reviews |
| `trips` | Quotes, request → match → accept → PIN verify → complete/cancel → rate/tip, commuter history, driver "today" list |
| `payments` | Wallet balance/top-up (Monnify-backed), payment methods, promotions lookup, Monnify webhook stub |
| `premium-business` | Commuter-facing premium vehicle marketplace + bookings, business-partner vehicle/booking/team management |
| `admin` | Dashboard overview, transporters/commuters, trips oversight, verifications queue, disputes, support, pricing, promotions, payouts, premium-ride oversight, team & roles — every route RBAC-gated |
| `notifications` | Shared in-app notification feed for every persona |
| `rbac` | Permission/role constants shared by the auth + admin modules |
| `support` | Commuter/driver disputes + support tickets with message threads (admin reply/escalate live under `/admin`), SLA helpers |
| `places` | Place search / reverse geocoding behind the `GeocodingProvider` interface (seeded DB catalogue) |
| `uploads` | Authenticated file download for stored documents (`/files/*`) |

## New endpoints (backend-gap closure)

All under `/api/v1`, envelope `{success,data}`, money in kobo. "R" = required role/permission.

**Business partner (`/premium-business`, user type `business`; mutating routes need team role owner/manager, payout account needs owner)**

| Method + path | Purpose |
|---|---|
| `GET /bookings?tab=requests\|active\|upcoming\|completed\|all&status=` | Partner booking list (customer name/rating/history, commission, net, deposit info) |
| `GET /bookings/requests` | Pending requests (status `requested`) with `expiresInMinutes` |
| `GET /bookings/:id` | Single booking; `:id` is the uuid **or** the short reference `PR-1A2B3C` |
| `GET /bookings/:id/timeline` | `[ {key,title,subtitle,when,state:done\|now\|pending} ]` from `booking_events` |
| `POST /bookings/:id/accept` · `POST /bookings/:id/decline {reason}` | Accept / decline a request (idempotent; expired requests are refused) |
| `POST /bookings/:id/start` | Vehicle handover (`confirmed` → `active`) |
| `POST /bookings/:id/inspection {items:{label:"ok"\|"issue"}, photos:[url], note, claimAmount}` | Return inspection; completes the booking, computes deposit claim/refund (one per booking, 409 on repeat) |
| `GET /vehicles/:id` | Single vehicle |
| `PUT /vehicles/:id/tiers {tiers:[{id,price,label?,sub?}]}` | Per-tier price update; `from_price` = cheapest tier |
| `GET /vehicles/:id/availability?month=YYYY-MM` · `PUT …/availability {month,blockedDays:[1..31]}` | Blocked/booked days (day-of-month) ; PUT replaces the month |
| `POST /vehicles/:id/availability/blocked {date,reason?}` · `DELETE …/blocked/:date` | Block / unblock one day |
| `GET/PATCH /settings {bookingMode:"instant"\|"request"}` | Per-business accept-required switch |
| `GET /earnings/summary` · `GET /payouts` | Earnings summary and payouts list (derived from bookings/deposits/`settlements`) |
| `GET/PUT /payout-account` | Business payout bank account (number is never returned, only masked) |

**Driver (`/drivers/me/*`, `/trips/*`, `/auth`)**

| Method + path | Purpose |
|---|---|
| `POST /auth/driver/apply` (public, rate-limited) | Creates a `pending` applicant + draft profile/vehicle and sends the login OTP; then `/auth/driver/otp/verify` + `/auth/driver/login` as usual. Admin approval activates the account |
| `GET/PUT /drivers/me/payout-account` | Payout bank account (masked); `GET …/earnings/balance` and `POST …/payouts/quote` now include `bank`; cash-out requires it |
| `POST /trips/:id/decline {reason?}` | Persisted decline (hidden from that driver's incoming list, real acceptance rate = accepted/(accepted+declined)) |
| `POST /trips/:id/end-early {reason?}` | Ends an in-progress trip (completes it, flagged `endedEarly`, fare unchanged) |
| `PATCH /drivers/me/status` | Now also tracks online sessions (`driver_online_sessions`) |
| `GET /drivers/me/dashboard` | `earnedToday, tripsToday, onlineSeconds/onlineDuration, distanceKm, acceptanceRate, yesterdayEarned, yesterdayTrips, weekEarned` |
| `GET /drivers/me/earnings?period=today\|yesterday\|week\|month` | Adds `onlineSeconds`, `onlineHours`, `distanceKm`, `series[{key,label,amount,trips}]` (hourly / Mon–Sun / 7-day blocks) |
| `GET/PATCH /drivers/me/settings` | Preferences (`autoAcceptNearby, longTripsOnly, voiceNavigation, readRequestsAloud, shareTripsWithFamily, navigationApp`) + `emergencyContactsCount` |
| `POST /drivers/me/documents/:key/upload` (multipart, field `file`) | JPG/PNG/WebP/PDF ≤ 5 MB, type sniffed from magic bytes, stored via `StorageProvider`, status `pending`. `GET /files/*` serves it to the owner / admins with `verifications.view` only |
| Driver view of a trip | `commuter {name ("Adaeze N."), initials, rating, trips, paymentMethod, cardLast4}`, `serviceFeePct`, `netEarning`; **no `pin`** |

**Commuter**

| Method + path | Purpose |
|---|---|
| `GET /places/search?q=&lat=&lng=&limit=` · `GET /places/reverse?lat=&lng=` | Autocomplete / reverse geocode — seeded catalogue by default, or real Google Places/Geocoding with `GEOCODING_PROVIDER=google` (see "Geocoding" under Design decisions) |
| `GET/POST /trips/scheduled` · `POST /trips/scheduled/:id/cancel` (or `DELETE`) | Scheduled rides (stored; automatic dispatch at the due time is **not** implemented) |
| `POST /trips` with `promoCode` | Server validates the code; `fare` is then the PRE-discount quote and the stored `fare` is the discounted amount, `promoDiscount`/`promoCode` are returned |
| Trip DTO | New `cancelFee`, `cancelReason`, `cancelledBy`, `promoCode`, `endedEarly` |
| `DELETE /users/me` | Soft delete + anonymise; refused while a ride is active or the wallet is non-empty |

**Support / disputes (commuter + driver `/support/*`, admin under `/admin`)**

| Method + path | Purpose |
|---|---|
| `GET/POST /support/disputes` · `GET /support/disputes/:id` · `POST /support/disputes/:id/messages` | Requester disputes (thread, `slaDueAt`, `slaStatus`) |
| `GET/POST /support/tickets` · `GET /support/tickets/:id` · `POST /support/tickets/:id/messages` | Requester support tickets |
| `GET /admin/disputes/:id` (R `disputes.view`), `POST …/reply`, `POST …/escalate` (R `disputes.resolve`) | Admin thread, reply, escalate |
| `GET /admin/support/:id` (R `support.view`), `POST …/reply`, `POST …/escalate` (R `support.manage`) | Same for tickets |
| `GET /admin/disputes`, `GET /admin/support` | Now include `commuter_name`, `transporter_name`, `raised_by_role`, `trip_fare`, `requester_name`, `requester_role`, `assignee_name`, `message_count`, `sla_due_at`, `sla_status`, `sla_remaining_minutes`, `escalated` |

### Design decisions worth knowing

- **Accept-required bookings.** `businesses.booking_mode` is `instant` (default,
  legacy behaviour: bookings are `confirmed` immediately) or `request` (booking
  starts as `requested`, the partner must accept or decline before
  `respond_by` = now + `BOOKING_REQUEST_TTL_HOURS`, otherwise it becomes
  `expired`). Commuter `POST /premium/bookings` is unchanged; the response
  `status` is simply `requested` or `confirmed`. Expiry is applied lazily on
  reads (no cron needed).
- **Deposit maths.** `claim = min(requestedClaim, held)`, `refund = held − claim`.
  No claim → deposit status `refunded`; claim > 0 → `disputed` (= proposed
  amounts awaiting Routta's decision through `/admin/premium/deposits/:id`).
  **No money moves** on booking, decline, inspection or refund yet: premium
  booking payment capture / deposit hold and release still need the Monnify flow.
- **Trip PIN.** `toTripDto(row, viewer)` in `trips.service.ts` is the single trip
  serialiser; `pin` is only emitted for the commuter viewer. Admin `reassign`
  strips it too. Driver verification is limited to 5 wrong attempts (HTTP 429).
- **Storage.** `src/integrations/storage` exposes `StorageProvider`
  (`put/get/delete`), implemented by `LocalDiskStorage` (`UPLOAD_DIR`). Keys are
  server generated; there is no public static mount. For S3, implement the
  interface and return it from `getStorage()`.
- **Geocoding: two swappable providers.** `GeocodingProvider`
  (`src/modules/places/geocoding.ts`) has two implementations, picked by
  `getGeocodingProvider()` based on `GEOCODING_PROVIDER` (`db` default,
  `google` to opt in — see `src/config/env.ts`'s `geocodingProvider` doc
  comment for the full tradeoff):
  - `DbGeocodingProvider` — the seeded `places_catalog` table. Free, no
    network dependency, coverage limited to the seed data.
  - `GoogleGeocodingProvider` (`src/modules/places/googleGeocoding.ts`) —
    real Google Places Text Search (`search`) + Geocoding API (`reverse`),
    biased to Lagos/Nigeria, using `GOOGLE_MAPS_SERVER_API_KEY`. Costs per
    request; degrades to an empty result (never throws) on any failure —
    HTTP error, non-OK Google status, network error, missing key — the same
    pattern as the Monnify/Resend/Termii adapters.

  Same flag also gates **road distance/ETA for trip fares and quotes**:
  when `GEOCODING_PROVIDER=google`, `resolveDistanceKm()` in
  `trips.service.ts` first tries `getRoadDistance()`
  (`src/integrations/google/directions.ts`, Google Directions API) and falls
  back to the existing haversine straight-line `distanceKm()` estimate
  (`src/common/utils/geo.ts`) on any failure. `getRoadDistance()` also
  returns the route's encoded polyline when available, but it is not yet
  persisted anywhere (would need a new `trips` column + migration) —
  flagged as a follow-up rather than done here.

  **Live-tested 2026-09-24** against the real `GOOGLE_MAPS_SERVER_API_KEY`
  with `GEOCODING_PROVIDER=google`: all three calls (Places Text Search,
  Geocoding reverse, Directions) reached Google and came back
  `REQUEST_DENIED`, and all three were handled gracefully (logged, no
  throw, empty/null/haversine fallback — verified via the response body and
  server logs, not just reading the code):
  - Places Text Search + Geocoding: `"You must enable Billing on the Google
    Cloud Project"` — **Billing is not enabled on the Google Cloud project**
    tied to this key. This is a project-level setting, separate from which
    individual APIs are toggled on in the API library — Places API and
    Geocoding API being "enabled" is not sufficient on its own; enable
    billing at
    https://console.cloud.google.com/project/_/billing/enable to unlock
    live search/reverse.
  - Directions: `"You're calling a legacy API, which is not enabled for
    your project... switch to the Places API (New) or Routes API"` — i.e.
    the (legacy) Directions API itself is not enabled, as expected. Enable
    it at
    https://console.cloud.google.com/apis/library/directions-backend.googleapis.com,
    or migrate `directions.ts` to the newer Routes API
    (https://console.cloud.google.com/apis/library/routes.googleapis.com).
    Enabling billing alone will not fix this one — the API itself also
    needs enabling.

### Trip completion & earnings

`POST /trips/:id/complete` (driver or commuter; allowed from
accepted/enroute/arrived/in_progress) marks the trip completed and calls
`dispatchTripSettlement`. `settleTrip(tripId)` claims the trip atomically
(`UPDATE trips SET settled_at … WHERE settled_at IS NULL`) in the same DB
transaction as the wallet credit, ledger row and `driver_profiles` counters, and a
partial unique index (`transactions(trip_id) WHERE type='fare_payment'`) is a second guard, so retries,
the BullMQ worker and the inline fallback cannot double-credit. A startup +
5-minute `reconcileUnsettledTrips()` sweep covers a crash or Redis outage between
completion and enqueue.

### Card data (known problem, not fixed here)

The commuter app posts the raw card number/CVV to `POST /payments/methods`. The
server keeps only `last4` + expiry (never PAN/CVV) and there is a TODO in
`payments.service.ts`. Proper flow: Monnify hosted checkout/SDK collects the card,
a reusable card token comes back via the Monnify webhook (`provider_ref`), and the
API stores token + brand + last4 only; then remove `number`/`cvv` from the schema.

### Integrations (`src/integrations/*`)

| Adapter | Status |
|---|---|
| `monnify` | **Sandbox-shaped stub.** Real method signatures/request-response types matching Monnify's documented API (OAuth2 auth, init-transaction, verify transaction, disbursement, webhook parsing+signature check). No live HTTP calls unless `MONNIFY_LIVE_MODE=true` **and** real (non-`MK_TEST_...`) credentials are set — otherwise every method logs and returns a realistic mock response. |
| `resend` | **Sandbox-shaped stub.** Wraps the real `resend` SDK's `emails.send` call shape plus a few convenience templates (OTP email, trip receipt, payout confirmation). No live sends unless `RESEND_LIVE_MODE=true` and a real (non-`re_test_...`) API key is set. |
| `termii` | **Sandbox-shaped stub.** Mirrors Termii's `sendMessage` / `sendOtp` / `verifyOtp` REST contract. No live sends unless `TERMII_LIVE_MODE=true` and a real (non-`TL_TEST_...`) API key is set. |
| `verification` | **Research + stub only — NOT wired to any provider.** See `src/integrations/verification/README.md` for what the frontends expect, a researched shortlist of Nigeria-focused ID/licence/plate verification vendors (Prembly, Youverify, Smile Identity, Dojah, VerifyMe), and what's required before implementation. Every method always returns `pending_manual_review`. **Do not implement a real provider here without explicit user approval.** |
| `google/directions` | **Real integration, live-tested, currently blocked upstream.** `getRoadDistance()` calls the real Google Directions API (driving mode, `region=ng`) whenever `GEOCODING_PROVIDER=google`. Returns `null` on **any** failure — never throws — so `trips.service.ts` falls back to the haversine estimate. Live-tested 2026-09-24: the current key returns `REQUEST_DENIED` (legacy Directions API not enabled on the Google Cloud project) and the fallback engaged correctly. Enable Directions API (or migrate to the Routes API) to unlock it — see the "Geocoding" design-decisions section above. |

All three payment/comms "live" adapters read their behaviour from `*_LIVE_MODE` env flags
and a placeholder-shaped credential (`MK_TEST_...`, `re_test_...`,
`TL_TEST_...`) — flipping to production only requires supplying real
credentials and setting the flag; no code changes needed. `google/directions`
and `GoogleGeocodingProvider` instead key off `GEOCODING_PROVIDER=google` (no
placeholder-credential convention — `GOOGLE_MAPS_SERVER_API_KEY` is either a
real key or empty).

## Database schema (Knex migrations, `src/db/migrations`)

Core tables: `users` (single identity table, `user_type` discriminates
commuter/driver/admin/business), `otps`, `roles` / `permissions` /
`role_permissions` / `user_roles` (RBAC), `driver_profiles`, `vehicles`,
`documents` (generic owner_type/owner_id — driver, vehicle, or business
docs), `wallets`, `payment_methods`, `transactions`, `promotions`,
`saved_places`, `trips`, `disputes` / `dispute_messages`, `support_tickets`,
`businesses`, `business_team_members`, `premium_vehicles`, `premium_tiers`,
`premium_bookings`, `protection_deposits`, `settlements`, `payouts`,
`pricing_rules`, `premium_pricing_rules`, `admin_invites`, `notifications`,
`emergency_contacts`. All monetary columns are `bigint` minor units (kobo).

Seeds (`src/db/seeds`) populate RBAC roles/permissions, default pricing, and
one demo account per persona so the frontends' existing mock users have a
real counterpart: admin `funke@routta.ng` / `Rtt!Ops2026`, commuter
`+2348034112094` (Adaeze Nwosu), driver `+2348025550148` (Chinedu Okafor),
and business partner `kayode@eliteridelagos.ng` / `Elite!2026` for
"Elite Rides Lagos".

## Running it locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start Postgres + Redis

If Docker is available:

```bash
docker compose up -d
```

Otherwise, point `DATABASE_URL` / `REDIS_URL` in `.env` at any reachable
Postgres 14+ and Redis 6+ instance.

### 3. Configure environment

```bash
cp .env.example .env
# edit .env — the defaults already match docker-compose.yml
```

### 4. Run migrations + seed data

```bash
npm run migrate:latest
npm run seed:run
```

### 5. Start the API

```bash
npm run dev        # tsx watch, http://localhost:4000/api/v1
```

### 6. Start the background worker (separate process)

```bash
npm run worker:dev
```

### Production build

```bash
npm run build       # tsc -> dist/
npm start           # node dist/server.js
npm run worker       # node dist/jobs/workers/index.js (after build)
```

Later migrations (`2026091910…`): `trip_settlement_and_driver_flow` (trip
settlement/cancel-fee/PIN-attempt columns, driver bank + settings + acceptance
counters, `trip_declines`, `driver_online_sessions`, `users.deleted_at`),
`premium_booking_status_values` (`requested|declined|expired`),
`premium_partner_flow` (`businesses.booking_mode` + payout account, booking
request columns, `booking_events`, `booking_inspections`,
`premium_vehicle_blocked_days`, vehicle `year/plate`), and
`support_places_scheduled` (SLA/escalation columns, `ticket_messages`,
`places_catalog`, `scheduled_rides`). Seeds add an **online** demo driver, a
pending partner booking request, an active/confirmed/completed booking mix, a
pending driver applicant, disputes/tickets with threads, saved places, promo
codes (`WELCOME20`, `FLAT500`) and the place catalogue.

## Tests

```bash
# needs a THROWAWAY database whose name contains "test" (the suite runs migrations
# and seeds, which delete data)
export TEST_DATABASE_URL=postgres://routta:routta@localhost:5432/routta_test
npm test
```

Vitest + supertest against the real Express app and Postgres, `JOBS_MODE=inline`
(no Redis needed). Covers: PIN never serialised to drivers/admins, completion
earnings idempotency (retries, worker + inline, 8-way concurrency, DB unique
index), partner accept/decline/expiry/inspection + deposit maths, availability,
earnings, RBAC denials (wrong persona, missing admin permission, staff role,
other business), driver flows, support threads, uploads, places, scheduled rides,
promo/cancel fee and delete-account.

## What's verified vs. not

- `npm run build` is clean; the suite above passes against a real PostgreSQL 15
  (migrations and seeds executed from scratch).
- The no-Redis fallback was also smoke-tested over HTTP with `JOBS_MODE=auto`
  and no Redis running (completion credited once, repeat call no double credit).
- **Not run:** the BullMQ worker against a real Redis (Redis was unavailable), and
  nothing was tested against a live Monnify/Resend/Termii.
- No real Monnify/Resend/Termii credentials exist, by design — every
  adapter call in dev mode is a logged mock, never a real HTTP request.
- `GoogleGeocodingProvider`, `getRoadDistance()` and the `GEOCODING_PROVIDER`
  switch were live-tested 2026-09-24 against the real
  `GOOGLE_MAPS_SERVER_API_KEY`, booted against a throwaway scratch Postgres
  (not `.local-postgres`/port 5433) on an unused port. All three calls
  (Places search, Geocoding reverse, Directions) currently come back
  `REQUEST_DENIED` from Google (billing not enabled on the project for
  search/reverse; the legacy Directions API not enabled for directions) and
  all three degraded gracefully — logged, no throw, empty/null/haversine
  fallback confirmed in both the HTTP response and the server logs. See the
  "Geocoding" design-decisions section above for exactly what to enable in
  Google Cloud Console to make each one live.

## Deliberate gaps / TODOs

- **Identity/licence/plate verification provider**: intentionally not
  integrated. See `src/integrations/verification/README.md`.
- Trip dispatch/matching is a simple polling-based simulation (an online
  driver with a matching vehicle category gets auto-assigned when the
  commuter polls `GET /trips/:id`), not a real-time geospatial dispatch
  engine or websocket push channel.
- Settlement batch job (`admin.runSettlement`) is a stub trigger point;
  the actual periodic aggregation-by-business job is not implemented.
- Scheduled rides are stored/listed/cancelled but there is no dispatcher that
  turns a due ride into a live trip yet.
- Late-cancellation fee is recorded on the trip (`cancel_fee`) but not yet
  debited from the commuter or credited to the driver; premium booking payment
  capture and deposit release/refund do not move money yet (needs Monnify).
- Business partner pilots roster / pilot assignment, vehicle disable/unlist,
  business registration + phone-OTP login, Google/OAuth sign-in and live
  tracking / demand heat-zones remain open (frontend `BACKEND-GAP`s not covered
  by the endpoints above).
- Rate limiting exists only on `POST /auth/driver/apply` (in-memory); the OTP
  send endpoints and login are not rate-limited yet. `requireUserType` answers
  a wrong persona with 401 (not 403).
- `docs`/OpenAPI spec generation not set up — routes are documented by this
  README + inline comments only.
# server
