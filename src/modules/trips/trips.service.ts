import { tripsRepository, tripsExtraRepository } from "./trips.repository";
import { distanceKm } from "@/common/utils/geo";
import { AppError, NotFoundError, ValidationError, ForbiddenError } from "@/common/utils/errors";
import { shortName, initialsOf, fullName } from "@/common/utils/dto";
import { eventBus, DomainEvents } from "@/events/eventBus";
import { dispatchTripSettlement } from "@/jobs/dispatch";
import { paymentsRepository } from "@/modules/payments/payments.repository";
import { env } from "@/config/env";
import { db } from "@/db/knex";
import { logger } from "@/common/utils/logger";
import { getRoadDistance } from "@/integrations/google/directions";

const CATEGORY_LABELS: Record<string, string> = { bike: "Bike", car: "Car", bus: "Bus", van: "Van" };
const CATEGORY_BASE_FARE_KOBO: Record<string, number> = { bike: 30000, car: 50000, bus: 890000, van: 1420000 };
const ACTIVE_STATUSES = ["accepted", "enroute", "arrived", "in_progress", "active"];
const MAX_PIN_ATTEMPTS = 5;

/** Who is looking at the trip. This controls which fields are serialised (see toTripDto). */
export type TripViewer = "commuter" | "driver" | "admin";

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Trip distance for fare/quote purposes. When GEOCODING_PROVIDER=google (see env.ts's doc comment for
 * why this reuses that one flag instead of a dedicated one) we first try Google Directions for real road
 * distance (src/integrations/google/directions.ts); on ANY failure — including the current
 * GOOGLE_MAPS_SERVER_API_KEY not having Directions/Routes enabled yet, which returns REQUEST_DENIED —
 * getRoadDistance() logs and resolves `null` rather than throwing, and we fall back to the same
 * straight-line haversine estimate used before this integration existed. Route ETA/polyline from a
 * successful Directions call are deliberately not persisted here (would need a new `trips` column +
 * migration) — noted as a follow-up rather than done here.
 */
async function resolveDistanceKm(pickup: { lat: number; lng: number }, destination: { lat: number; lng: number }): Promise<number> {
  if (env.geocodingProvider === "google") {
    const road = await getRoadDistance(pickup, destination);
    if (road) return road.distanceKm;
  }
  return distanceKm(pickup.lat, pickup.lng, destination.lat, destination.lng);
}

async function computeFare(category: string, distance: number): Promise<{ fare: number; etaMinutes: number }> {
  const rules = await tripsRepository.listPricingRules();
  const rule = rules.find((r) => r.category === category);
  const ratePerKm = Number(rule?.rate_per_km ?? 0);
  const base = CATEGORY_BASE_FARE_KOBO[category] ?? 50000;
  const fare = ratePerKm > 0 ? Math.round(base * 0.3 + ratePerKm * distance) : base;
  const etaMinutes = category === "bike" ? 2 : category === "car" ? 4 : category === "bus" ? 9 : 12;
  return { fare, etaMinutes };
}

interface DtoContext {
  driverInfo?: any;
  vehicle?: any;
  commuter?: any;
  paymentMethod?: any;
  serviceFeePct?: number;
}

/**
 * THE trip serialiser. Every trip response in the API goes through here.
 *
 * SECURITY: the arrival PIN is the commuter's proof to the driver that the right person is in the car.
 * It is serialised ONLY for the commuter viewer. Drivers (and admins) never receive it — the driver
 * verifies it by typing in what the commuter reads out (POST /trips/:id/verify-pin).
 */
export function toTripDto(row: any, viewer: TripViewer, ctx: DtoContext = {}) {
  const { driverInfo, vehicle, commuter, paymentMethod, serviceFeePct } = ctx;
  const dto: Record<string, unknown> = {
    id: row.id,
    status: row.status,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category],
    pickup: { label: row.pickup_label, lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
    destination: { label: row.destination_label, lat: Number(row.destination_lat), lng: Number(row.destination_lng) },
    distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
    etaMinutes: row.eta_minutes,
    fare: Number(row.fare),
    promoDiscount: Number(row.promo_discount ?? 0),
    promoCode: row.promo_code ?? null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    cancelFee: Number(row.cancel_fee ?? 0),
    cancelledBy: !row.cancelled_by ? null : row.cancelled_by === row.commuter_id ? "commuter" : row.cancelled_by === row.driver_id ? "driver" : "admin",
    endedEarly: !!row.ended_early,
    ratingByCommuter: row.rating_by_commuter !== null && row.rating_by_commuter !== undefined ? Number(row.rating_by_commuter) : null,
  };

  if (viewer === "commuter") {
    dto.pin = row.pin;
    if (driverInfo) {
      dto.transporter = {
        id: driverInfo.id,
        name: fullName(driverInfo),
        rating: Number(driverInfo.rating),
        trips: driverInfo.total_trips,
        vehiclePlate: vehicle?.plate ?? "",
        vehicleModel: vehicle ? `${vehicle.colour ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() : "",
        phone: driverInfo.phone,
      };
    }
  }

  if (viewer === "driver") {
    // Counterparty details the driver needs, deliberately minimal (no phone, surname reduced to an initial).
    dto.commuter = {
      name: shortName(commuter),
      initials: initialsOf(commuter),
      rating: commuter ? Number(commuter.rating) : 0,
      trips: commuter ? Number(commuter.trips ?? 0) : 0,
      paymentMethod: paymentMethod ? (paymentMethod.kind === "card" ? "card" : paymentMethod.kind) : "wallet",
      cardLast4: paymentMethod?.kind === "card" ? (paymentMethod.last4 ?? "") : "",
    };
    const pct = serviceFeePct ?? 15;
    const fare = Number(row.fare);
    dto.serviceFeePct = pct;
    dto.netEarning = row.driver_earning !== null && row.driver_earning !== undefined ? Number(row.driver_earning) : fare - Math.round(fare * (pct / 100));
  }

  if (viewer === "admin") {
    dto.commuterId = row.commuter_id;
    dto.driverId = row.driver_id;
  }
  return dto;
}

async function present(row: any, viewer: TripViewer) {
  const ctx: DtoContext = {};
  if (viewer === "driver") {
    const [commuter, paymentMethod, profile] = await Promise.all([
      tripsExtraRepository.commuterSummary(row.commuter_id),
      row.payment_method_id ? tripsExtraRepository.paymentMethod(row.payment_method_id) : undefined,
      row.driver_id ? tripsExtraRepository.driverProfile(row.driver_id) : undefined,
    ]);
    ctx.commuter = commuter;
    ctx.paymentMethod = paymentMethod;
    ctx.serviceFeePct = profile ? Number(profile.service_fee_pct) : undefined;
  } else if (row.driver_id) {
    ctx.driverInfo = await tripsRepository.driverInfoForTrip(row.driver_id);
    ctx.vehicle = await tripsRepository.vehicleForDriver(row.driver_id);
  }
  return toTripDto(row, viewer, ctx);
}

function viewerFor(userType: string, permissions: string[] = []): TripViewer {
  if (userType === "commuter") return "commuter";
  if (userType === "driver") return "driver";
  if (userType === "admin" && permissions.includes("trips.view")) return "admin";
  throw new ForbiddenError("You do not have access to trips.");
}

/** Validates a promo code for a trip and returns the discount in kobo (fixed values are kobo). */
async function applyPromo(code: string, category: string, grossFare: number) {
  const promo = await paymentsRepository.activePromoByCode(code);
  const now = new Date();
  if (!promo) throw new ValidationError("This promo code is not valid.");
  if (promo.starts_at && new Date(promo.starts_at) > now) throw new ValidationError("This promo code is not active yet.");
  if (promo.ends_at && new Date(promo.ends_at) < now) throw new ValidationError("This promo code has expired.");
  if (promo.category_scope !== "all" && promo.category_scope !== category) throw new ValidationError(`This promo code is only valid for ${promo.category_scope} rides.`);
  if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) throw new ValidationError("This promo code has reached its usage limit.");
  const raw = promo.discount_type === "percent" ? Math.round((grossFare * Number(promo.discount_value)) / 100) : Math.round(Number(promo.discount_value));
  return { promo, discount: Math.min(Math.max(raw, 0), grossFare) };
}

export const tripsService = {
  async getQuotes(pickup: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
    const distance = await resolveDistanceKm(pickup, destination);
    const categories = ["bike", "car", "bus", "van"];
    const quotes = await Promise.all(
      categories.map(async (category) => {
        const { fare, etaMinutes } = await computeFare(category, distance);
        return { category, categoryLabel: CATEGORY_LABELS[category], distanceKm: distance, etaMinutes, fare };
      })
    );
    return quotes;
  },

  async getCapacityOptions(category: "bus" | "van") {
    const base = CATEGORY_BASE_FARE_KOBO[category];
    if (category === "bus") {
      return [
        { id: "bus_16", label: "16-seater minibus", description: "Best for small groups", fare: base },
        { id: "bus_22", label: "22-seater coaster", description: "Mid-size group travel", fare: Math.round(base * 1.28) },
        { id: "bus_30", label: "30-seater coach", description: "Large group / events", fare: Math.round(base * 1.78) },
      ];
    }
    return [
      { id: "van_1", label: "1 ton", description: "Small loads, few items", fare: base },
      { id: "van_3", label: "3 tons", description: "Household moving", fare: Math.round(base * 1.39) },
      { id: "van_5", label: "5 tons", description: "Large / commercial loads", fare: Math.round(base * 1.87) },
    ];
  },

  /**
   * Creates a trip. If `promoCode` is sent, `input.fare` is treated as the PRE-discount quoted fare: the server
   * validates the code, stores `promo_discount`, and stores `fare` as the discounted amount actually payable.
   * Without a code `input.fare` is stored as-is (legacy behaviour: the app may already have discounted it).
   */
  async requestTrip(commuterId: string, input: any) {
    const distance = input.distanceKm ?? (await resolveDistanceKm(input.pickup, input.destination));
    let fare = input.fare as number;
    let promoDiscount = 0;
    let promoCode: string | undefined;
    if (input.promoCode) {
      const { promo, discount } = await applyPromo(input.promoCode, input.category, fare);
      promoDiscount = discount;
      promoCode = promo.code;
      fare = fare - discount;
      await db("promotions").where({ id: promo.id }).increment("used_count", 1);
    }
    const pin = generatePin();
    const [row] = await tripsRepository.create({
      commuter_id: commuterId,
      category: input.category,
      pickup_label: input.pickup.label,
      pickup_lat: input.pickup.lat,
      pickup_lng: input.pickup.lng,
      destination_label: input.destination.label,
      destination_lat: input.destination.lat,
      destination_lng: input.destination.lng,
      distance_km: distance,
      eta_minutes: 3,
      fare,
      promo_discount: promoDiscount,
      promo_code: promoCode,
      payment_method_id: input.paymentMethodId,
      pin,
      status: "matching",
    });
    // The arrival PIN is never sent via SMS — it's only ever shown in the commuter app (see
    // toTripDto's viewer-based serialisation). Log it so it's visible without opening that UI.
    logger.warn({ tripId: row.id, pin }, "[TRIP-PIN] not sent via SMS (shown in commuter app only) — pin for manual testing");
    eventBus.publish(DomainEvents.TripRequested, { tripId: row.id });
    return present(row, "commuter");
  },

  async getTrip(tripId: string, requesterId: string, requesterType: string, permissions: string[] = []) {
    const viewer = viewerFor(requesterType, permissions);
    const row = await tripsRepository.findById(tripId);
    if (!row) throw new NotFoundError("Trip not found");
    if (viewer === "commuter" && row.commuter_id !== requesterId) throw new ForbiddenError();
    if (viewer === "driver" && row.driver_id && row.driver_id !== requesterId) throw new ForbiddenError();

    // Lightweight auto-match simulation for a commuter polling a "matching" trip:
    // if an online driver with a matching vehicle category is free, assign them.
    if (row.status === "matching" && viewer === "commuter") {
      const candidate = await tripsRepository.findMatchCandidateDriver(row.category, row.id);
      if (candidate) {
        const claimed = await tripsExtraRepository.claimForDriver(tripId, candidate.driver_id, candidate.vehicle_id);
        if (claimed) {
          eventBus.publish(DomainEvents.TripAccepted, { tripId });
          return present(claimed, viewer);
        }
      }
    }
    return present(row, viewer);
  },

  async listIncomingForDriver(driverId: string) {
    const vehicle = await tripsRepository.vehicleForDriver(driverId);
    if (!vehicle) return [];
    const rows = await tripsRepository.listIncomingForDriver(vehicle.category, driverId);
    return Promise.all(rows.map((r) => present(r, "driver")));
  },

  async acceptTrip(tripId: string, driverId: string) {
    const row = await tripsRepository.findById(tripId);
    if (!row) throw new NotFoundError("Trip not found");
    // Idempotent: the commuter poll may already have auto-assigned this trip to this driver.
    if (row.status === "accepted" && row.driver_id === driverId) return present(row, "driver");
    if (row.status !== "matching") throw new ValidationError("This trip is no longer available.");
    const vehicle = await tripsRepository.vehicleForDriver(driverId);
    const claimed = await tripsExtraRepository.claimForDriver(tripId, driverId, vehicle?.id);
    if (!claimed) throw new ValidationError("This trip is no longer available.");
    await tripsExtraRepository.recordAccepted(driverId);
    eventBus.publish(DomainEvents.TripAccepted, { tripId });
    return present(claimed, "driver");
  },

  /** Persists the decline (excluded from this driver's incoming list from now on) and updates the acceptance rate. */
  async declineTrip(tripId: string, driverId: string, reason?: string) {
    const row = await tripsRepository.findById(tripId);
    if (!row) throw new NotFoundError("Trip not found");
    const openOffer = row.status === "matching";
    const autoAssignedToMe = row.status === "accepted" && row.driver_id === driverId;
    if (!openOffer && !autoAssignedToMe) throw new ValidationError("This trip can no longer be declined.");
    if (autoAssignedToMe) await tripsExtraRepository.releaseToMatching(tripId, driverId);
    const acceptanceRate = await tripsExtraRepository.recordDecline(tripId, driverId, reason);
    return { acceptanceRate };
  },

  async verifyArrivalPin(tripId: string, driverId: string, pin: string) {
    const row = await tripsRepository.findById(tripId);
    if (!row || row.driver_id !== driverId) throw new NotFoundError("Trip not found");
    if (!["accepted", "enroute", "arrived"].includes(row.status)) throw new ValidationError("This trip is not waiting for a PIN.");
    if (row.pin_attempts >= MAX_PIN_ATTEMPTS) throw new AppError("Too many incorrect PIN attempts. Ask the rider to contact support.", 429, "TOO_MANY_ATTEMPTS");
    if (row.pin !== pin) {
      await tripsExtraRepository.bumpPinAttempts(tripId);
      throw new ValidationError("That PIN is not correct. Ask the rider for the 4-digit PIN in their app.");
    }
    const [updated] = await tripsRepository.update(tripId, { status: "in_progress", started_at: db.fn.now() });
    return present(updated, "driver");
  },

  /**
   * Completes a trip and makes sure the driver is paid: settlement is enqueued on BullMQ when Redis is up, or run
   * inline otherwise (see jobs/dispatch.ts). settleTrip is idempotent, so calling complete twice, or the worker
   * also running the job, never credits twice.
   */
  async completeTrip(tripId: string, requesterId: string, requesterType = "commuter") {
    const row = await tripsRepository.findById(tripId);
    if (!row) throw new NotFoundError("Trip not found");
    if (row.driver_id !== requesterId && row.commuter_id !== requesterId) throw new ForbiddenError();
    const viewer: TripViewer = requesterType === "driver" ? "driver" : "commuter";

    if (row.status === "completed") {
      await dispatchTripSettlement(tripId); // retry-safe: no-op if already settled
      return present(row, viewer);
    }
    if (!ACTIVE_STATUSES.includes(row.status)) throw new ValidationError(`A ${row.status} trip cannot be completed.`);

    const [updated] = await db("trips")
      .where({ id: tripId })
      .whereIn("status", ACTIVE_STATUSES)
      .update({ status: "completed", completed_at: db.fn.now(), updated_at: db.fn.now() })
      .returning("*");
    if (!updated) return present((await tripsRepository.findById(tripId))!, viewer); // lost a race with a concurrent complete

    eventBus.publish(DomainEvents.TripCompleted, { tripId });
    await dispatchTripSettlement(tripId);
    return present((await tripsRepository.findById(tripId))!, viewer);
  },

  /** Driver ends an in-progress trip early (rider got out early / route abandoned). Fare is unchanged. */
  async endTripEarly(tripId: string, driverId: string, reason?: string) {
    const row = await tripsRepository.findById(tripId);
    if (!row || row.driver_id !== driverId) throw new NotFoundError("Trip not found");
    if (row.status === "completed") return present(row, "driver");
    if (!["in_progress", "active"].includes(row.status)) throw new ValidationError("Only a trip in progress can be ended early.");
    await db("trips").where({ id: tripId }).update({ ended_early: true, end_reason: reason ?? null });
    const updated = await this.completeTrip(tripId, driverId, "driver");
    return updated;
  },

  async cancelTrip(tripId: string, requesterId: string, reason?: string) {
    const row = await tripsRepository.findById(tripId);
    if (!row) throw new NotFoundError("Trip not found");
    if (row.commuter_id !== requesterId && row.driver_id !== requesterId) throw new ForbiddenError();
    const byCommuter = row.commuter_id === requesterId;
    const viewer: TripViewer = byCommuter ? "commuter" : "driver";
    if (row.status === "cancelled") return present(row, viewer);
    if (row.status === "completed") throw new ValidationError("A completed trip cannot be cancelled.");

    // Late-cancellation fee: commuter cancels after the driver has been on the way past the grace period (or has arrived).
    let cancelFee = 0;
    if (byCommuter && ["accepted", "enroute", "arrived"].includes(row.status)) {
      const elapsed = row.accepted_at ? (Date.now() - new Date(row.accepted_at).getTime()) / 1000 : 0;
      if (row.status === "arrived" || elapsed > env.cancelFeeGraceSeconds) cancelFee = Math.min(env.cancelFeeKobo, Number(row.fare));
    }
    const [updated] = await tripsRepository.update(tripId, {
      status: "cancelled",
      cancelled_at: db.fn.now(),
      cancelled_by: requesterId,
      cancel_reason: reason,
      cancel_fee: cancelFee,
    });
    eventBus.publish(DomainEvents.TripCancelled, { tripId });
    // TODO(payments): the fee is recorded on the trip; debiting it from the commuter's wallet/card and crediting the
    // driver is not wired yet (needs the Monnify tokenised-card flow).
    return present(updated, viewer);
  },

  async rateTrip(tripId: string, commuterId: string, rating: number) {
    const row = await tripsRepository.findById(tripId);
    if (!row || row.commuter_id !== commuterId) throw new NotFoundError("Trip not found");
    const [updated] = await tripsRepository.update(tripId, { rating_by_commuter: rating });
    return present(updated, "commuter");
  },

  async sendTip(tripId: string, commuterId: string, amount: number) {
    const row = await tripsRepository.findById(tripId);
    if (!row || row.commuter_id !== commuterId) throw new NotFoundError("Trip not found");
    if (!row.driver_id) throw new ValidationError("This trip has no assigned driver to tip.");
    await db.transaction(async (trx) => {
      const driverWallet = await trx("wallets").where({ user_id: row.driver_id }).first();
      if (driverWallet) {
        await trx("wallets").where({ id: driverWallet.id }).increment("balance", amount);
        await trx("transactions").insert({
          wallet_id: driverWallet.id,
          user_id: row.driver_id,
          type: "adjustment",
          amount,
          status: "successful",
          provider: "internal",
          trip_id: tripId,
          metadata: JSON.stringify({ reason: "tip", from: commuterId }),
        });
      }
    });
    return { sent: true };
  },

  async historyForCommuter(commuterId: string, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      tripsRepository.historyForCommuter(commuterId, offset, pageSize),
      tripsRepository.countHistoryForCommuter(commuterId),
    ]);
    const items = await Promise.all(rows.map((r) => present(r, "commuter")));
    return { items, total: Number(countRow?.count ?? 0), page, pageSize };
  },

  async todayForDriver(driverId: string) {
    const rows = await tripsRepository.todayForDriver(driverId);
    return Promise.all(rows.map((r) => present(r, "driver")));
  },
};
