# Identity / License / Number-Plate Verification — RESEARCH ONLY, NOT INTEGRATED

**Status: no provider has been chosen or wired up. This directory contains
research notes and a mocked stub module only. Do not integrate a real
provider here without explicit user approval and real API credentials.**

This is a deliberate, explicit gap per the project brief: picking and wiring
a real identity-verification vendor needs a human decision (cost, coverage,
compliance posture, data-handling agreement) that this scaffolding pass is
not authorized to make.

## (a) What the frontends already assume exists

### `transporter-mobile` (driver app)

`src/services/documentsService.ts` + `src/types/index.ts` define a document
list and per-document lifecycle:

```ts
type DocumentStatus = 'current' | 'expiring' | 'expired' | 'missing' | 'pending';

interface DriverDocument {
  key: 'licence' | 'inspection' | 'insurance' | 'registration' | 'address';
  name: string;
  hint: string;
  status: DocumentStatus;
  meta: string; // e.g. "Expires in 12 days", "Under review · usually within 24 hours"
}
```

- `documentsService.list()` → `GET` the driver's current documents + statuses.
- `documentsService.uploadRenewal(key, file)` → upload a replacement file for
  one document; the mock immediately flips it to `status: 'pending'` with a
  "usually within 24 hours" message, implying an async (likely
  human-reviewed, possibly provider-assisted) review pipeline, not a
  synchronous verdict.
- The document set here is vehicle/licence-centric: driver's licence,
  roadworthiness/vehicle inspection, insurance, vehicle registration, and
  proof of address. There is no NIN/BVN field in this mock today, but the
  backend's `documents` table (`owner_type: 'driver' | 'vehicle'`, `doc_key`
  free-text) already has room for one (`doc_key: 'nin'`) once that's decided.

### `web-ui` (admin dashboard) — Verifications queue

`src/services/verifications-service.ts` + `src/types/index.ts`:

```ts
interface DocumentCheck {
  name: string
  status: 'ok' | 'flag' | 'missing'
  meta: string
}

interface VerificationApplicant {
  id: string
  name: string
  category: VehicleCategory   // 'car' | 'bike' | 'bus' | 'van'
  appliedAgo: string
  phone: string
  tag: string
  variant: StatusVariant
  flag: string | null
  documents: DocumentCheck[]
}
```

Admin actions on an applicant: `approveApplicant(id)`, `rejectApplicant(id)`,
`requestClearerDocument(id)` (asks the applicant to re-upload a flagged
document). This is a **manual review queue UI** — nothing in the current
frontend mock assumes a specific automated verification vendor. The
`flag`/`DocumentCheck.status: 'flag'` fields suggest the UI is designed to
surface either a human reviewer's or an automated provider's concerns
(mismatched name, blurry photo, expired document, etc.) inline per document.

Premium Ride business verification (`premium-ride-service.ts`) follows the
same shape at the business level: `actOnPremiumBusiness(id, 'approve' |
'reject' | 'suspend' | 'request-changes')` against a business's uploaded
documents (`PREMIUM_BUSINESS_DOCS`).

### Backend tables already scaffolded to receive this

- `documents` (`src/db/migrations/20240101000003_...`): generic
  `owner_type` (`driver` | `business` | `vehicle`), `doc_key`, `status`
  (`missing | pending | current | expiring | expired | rejected`),
  `reviewed_by`, `reviewed_at`, `expires_at`. This shape supports either a
  human-only review queue (what's implemented today) or bolting an
  automated provider verdict onto the same row later (e.g. add
  `provider`, `provider_reference`, `provider_verdict` columns when a
  provider is chosen).

**Net: today's real backend implementation is a human-reviewed
"pending → approved/rejected" workflow** (`src/modules/admin` verifications
endpoints + `src/modules/drivers` document upload endpoints), matching what
the frontends currently render. The stub module in this directory
(`index.ts`) exists purely so a future automated check can be dropped in
behind the same call sites without changing the rest of the codebase.

## (b) Researched provider options (Nigeria-focused)

Termii (SMS/OTP) and Monnify (payments) are both Nigeria-first providers, so
identity verification should very likely also be a Nigeria/Africa-focused
vendor with direct NIMC (NIN), FRSC (driver's licence), and vehicle-registry
integrations rather than a global KYC vendor with weak local coverage.
Below is a starting shortlist — **verify current pricing, coverage, and
contract terms directly with each vendor before deciding**; this list is
based on their public positioning and may be stale by the time this is read.

| Provider | Nigeria coverage (NIN / DL / plate) | One-line tradeoff |
|---|---|---|
| **Prembly** (Identitypass) | NIN, BVN, driver's licence, CAC, vehicle (plate) lookups, liveness/facial match | Broad single-API coverage of exactly the Nigerian registries Routta needs (driver + vehicle); popular with Nigerian fintech/mobility startups, but newer/smaller than global players so do extra SLA/uptime diligence. |
| **Youverify** | NIN, BVN, driver's licence, CAC, AML/watchlist screening, facial biometrics | Strong compliance/AML angle (useful if Routta ever needs KYC beyond drivers, e.g. premium-business KYB); pricing and docs skew toward enterprise/regulated-industry customers. |
| **Smile Identity** (Smile ID) | ID verification + biometric/liveness across NIN and other national IDs, pan-African (not just Nigeria) | Best pick if Routta expects to expand beyond Nigeria later (pan-African coverage from one vendor); biometric liveness is a strong anti-fraud fit for driver onboarding selfie checks. |
| **Dojah** | NIN, BVN, driver's licence, vehicle info, credit/AML checks, developer-friendly docs & sandbox | Good developer experience and fast sandbox onboarding for a small team scaffolding fast; being a smaller/newer vendor, double-check enterprise support and uptime track record. |
| **VerifyMe Nigeria** | NIN, BVN, driver's licence, international passport, digital address verification | One of the longer-established Nigerian identity-verification vendors with address-verification specifically (useful for the `address` document Routta's driver doc list already expects); UX/API feel more dated than Dojah/Prembly in some integrations. |

None of these have been contacted, benchmarked, or contracted. Cost,
turnaround SLA, and data-residency/compliance terms (NDPR) must be compared
before a choice is made — that comparison is explicitly out of scope for
this scaffolding pass.

## (c) Current implementation: stub only

`src/integrations/verification/index.ts` exports method signatures that
match the kind of calls a real provider adapter would expose
(`verifyNIN`, `verifyDriverLicense`, `verifyVehiclePlate`,
`verifyFacialMatch`), but **every method just returns a mocked
`status: 'pending_manual_review'` response** — it never calls out to any
external service. This gives `src/modules/drivers` and `src/modules/admin`
a stable interface to call today (matching the human-review workflow the
frontends already render), without committing to a vendor.

## Before this goes live

1. Get explicit user sign-off on a provider from the shortlist above (or a
   different one).
2. Obtain real sandbox API credentials from that provider.
3. Implement the real HTTP calls in `index.ts` behind the same method
   signatures, following the `MONNIFY_LIVE_MODE` / `RESEND_LIVE_MODE` /
   `TERMII_LIVE_MODE` pattern used by the other three integrations (a
   `VERIFICATION_LIVE_MODE`-style flag, mock responses when it's off).
4. Test thoroughly against the provider's own sandbox before touching
   production driver/business onboarding.
5. Confirm NDPR (Nigeria Data Protection Regulation) compliance for storing
   any NIN/BVN/biometric data this integration would introduce.
