import { premiumRepository, partnerRepository } from "./premium.repository";
import { db } from "@/db/knex";
import { env } from "@/config/env";
import { dateOnly, localDateString } from "@/common/utils/time";
import { dispatchNotification } from "@/jobs/dispatch";
import { NotFoundError, ValidationError, ForbiddenError } from "@/common/utils/errors";
import { eventBus, DomainEvents } from "@/events/eventBus";

function toVehicleDto(row: any, tiers: any[] = [], business?: any) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    brand: row.brand,
    businessId: row.business_id,
    businessName: business?.name,
    location: row.location,
    rating: Number(row.rating),
    reviews: row.reviews,
    fromPrice: Number(row.from_price),
    seats: row.seats ? `${row.seats} seats` : undefined,
    year: row.year ?? null,
    plate: row.plate ?? null,
    availability: row.availability,
    status: row.status,
    specs: row.specs,
    tiers: tiers.map(toTierDto),
  };
}

function toTierDto(row: any) {
  return { id: row.id, label: row.label, sub: row.sub, price: Number(row.price) };
}

function toBookingDto(row: any, vehicle?: any, tier?: any) {
  return {
    id: row.id,
    vehicle: vehicle ? toVehicleDto(vehicle, [], undefined) : undefined,
    tier: tier ? toTierDto(tier) : undefined,
    date: row.booking_date,
    startTime: row.start_time,
    endHours: row.duration_hours,
    status: row.status,
    deposit: Number(row.deposit),
    serviceFee: Number(row.service_fee),
    total: Number(row.total),
    pilotName: row.pilot_name,
    pilotRating: row.pilot_rating ? Number(row.pilot_rating) : undefined,
    // Present when the business requires acceptance ("requested" -> "confirmed" | "declined" | "expired")
    requestedAt: row.requested_at ?? null,
    respondBy: row.respond_by ?? null,
    declineReason: row.decline_reason ?? null,
  };
}

export const premiumService = {
  // ---- Commuter-facing marketplace ----

  async listVehicles() {
    const rows = await premiumRepository.listLiveVehicles();
    return Promise.all(
      rows.map(async (r) => {
        const [tiers, business] = await Promise.all([premiumRepository.tiersForVehicle(r.id), premiumRepository.findBusiness(r.business_id)]);
        return toVehicleDto(r, tiers, business);
      })
    );
  },

  async getFeatured() {
    const all = await this.listVehicles();
    return all.slice(0, 2);
  },

  async getVehicle(id: string) {
    const row = await premiumRepository.findVehicle(id);
    if (!row) throw new NotFoundError("Vehicle not found");
    const [tiers, business] = await Promise.all([premiumRepository.tiersForVehicle(id), premiumRepository.findBusiness(row.business_id)]);
    return toVehicleDto(row, tiers, business);
  },

  async getBusiness(id: string) {
    const row = await premiumRepository.findBusiness(id);
    if (!row) throw new NotFoundError("Business not found");
    const vehicles = await premiumRepository.vehiclesForBusiness(id);
    return {
      id: row.id,
      name: row.name,
      initials: row.name
        .split(" ")
        .map((w: string) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      location: row.location,
      verifiedSince: row.verified_since ? String(new Date(row.verified_since).getFullYear()) : "",
      rating: Number(row.rating),
      vehicleCount: vehicles.length,
      rentalCount: 0,
      about: row.about,
    };
  },

  /**
   * Creates a booking. Behaviour depends on the business's `booking_mode`:
   *   "instant" (default) -> status "confirmed" immediately (legacy behaviour, nothing changes for existing partners)
   *   "request"           -> status "requested"; the partner must accept or decline before `respond_by`
   *                          (BOOKING_REQUEST_TTL_HOURS, default 12h), after which it becomes "expired".
   */
  async createBooking(commuterId: string, input: { vehicleId: string; tierId: string; date: string; startTime: string; occasion?: string }) {
    const vehicle = await premiumRepository.findVehicle(input.vehicleId);
    if (!vehicle) throw new NotFoundError("Vehicle not found");
    if (vehicle.status !== "live") throw new ValidationError("This vehicle is not available for booking.");
    const tier = await premiumRepository.findTier(input.tierId);
    if (!tier || tier.vehicle_id !== vehicle.id) throw new ValidationError("Selected pricing tier is not valid for this vehicle.");
    if (input.date < localDateString()) throw new ValidationError("Choose today or a future date.");
    if (await partnerRepository.isDayBlocked(vehicle.id, input.date)) throw new ValidationError("This vehicle is not available on that date.");
    if (await partnerRepository.hasConfirmedOverlap(vehicle.id, input.date)) throw new ValidationError("This vehicle is already booked on that date.");

    const business = await premiumRepository.findBusiness(vehicle.business_id);
    const requiresAcceptance = business?.booking_mode === "request";
    const now = new Date();

    const tierPrice = Number(tier.price);
    const deposit = Math.round((tierPrice * 0.4) / 100) * 100;
    const serviceFee = Math.round((tierPrice * 0.04) / 100) * 100;
    const durationHours = Number(String(tier.label).split(" ")[0]) || 6;
    const commissionPct = await partnerRepository.commissionPct();

    const row = await db.transaction(async (trx) => {
      const [created] = await premiumRepository.createBooking(
        {
          vehicle_id: vehicle.id,
          tier_id: tier.id,
          business_id: vehicle.business_id,
          commuter_id: commuterId,
          booking_date: input.date,
          start_time: input.startTime,
          duration_hours: durationHours,
          status: requiresAcceptance ? "requested" : "confirmed",
          requested_at: requiresAcceptance ? now : null,
          respond_by: requiresAcceptance ? new Date(now.getTime() + env.bookingRequestTtlHours * 3_600_000) : null,
          commission_pct: commissionPct,
          occasion: input.occasion ?? null,
          deposit,
          service_fee: serviceFee,
          total: tierPrice + deposit + serviceFee,
        },
        trx
      );
      if (deposit > 0) await trx("protection_deposits").insert({ booking_id: created.id, held_amount: deposit });
      await partnerRepository.recordEvent(
        created.id,
        requiresAcceptance ? "requested" : "confirmed",
        requiresAcceptance ? "Request received" : "Booking confirmed",
        requiresAcceptance ? "Waiting for the partner to accept" : "Confirmed automatically",
        commuterId,
        trx
      );
      return created;
    });

    eventBus.publish(DomainEvents.PremiumBookingCreated, { bookingId: row.id, commuterId });
    if (business) {
      await dispatchNotification({
        userId: business.owner_user_id,
        title: requiresAcceptance ? "New booking request" : "New booking",
        body: requiresAcceptance ? `A commuter requested ${vehicle.name} on ${dateOnly(row.booking_date)}. Respond within ${env.bookingRequestTtlHours}h.` : `${vehicle.name} was booked for ${dateOnly(row.booking_date)}.`,
        kind: "system",
      });
    }
    return toBookingDto(row, vehicle, tier);
  },

  async getActiveBooking(commuterId: string) {
    await partnerRepository.expireStaleRequests();
    const row = await premiumRepository.latestActiveBookingForCommuter(commuterId);
    if (!row) throw new NotFoundError("No active premium booking");
    const [vehicle, tier] = await Promise.all([premiumRepository.findVehicle(row.vehicle_id), premiumRepository.findTier(row.tier_id)]);
    return toBookingDto(row, vehicle, tier);
  },

  async getBookingHistory(commuterId: string) {
    await partnerRepository.expireStaleRequests();
    const rows = await premiumRepository.bookingsForCommuter(commuterId);
    return Promise.all(
      rows.map(async (r) => {
        const [vehicle, tier] = await Promise.all([premiumRepository.findVehicle(r.vehicle_id), premiumRepository.findTier(r.tier_id)]);
        return toBookingDto(r, vehicle, tier);
      })
    );
  },

  // ---- Business-partner-facing management ----

  async requireBusinessForUser(userId: string) {
    const business = await premiumRepository.businessForUser(userId);
    if (!business) throw new ForbiddenError("No business membership found for this account.");
    return business;
  },

  async listVehiclesForBusiness(businessId: string) {
    const rows = await premiumRepository.vehiclesForBusiness(businessId);
    return Promise.all(
      rows.map(async (r) => toVehicleDto(r, await premiumRepository.tiersForVehicle(r.id)))
    );
  },

  async getVehicleForBusiness(businessId: string, id: string) {
    const row = await premiumRepository.findVehicleForBusiness(businessId, id);
    if (!row) throw new NotFoundError("Vehicle not found for this business");
    return toVehicleDto(row, await premiumRepository.tiersForVehicle(id));
  },

  async createVehicleForBusiness(businessId: string, input: any) {
    const [row] = await premiumRepository.createVehicle(businessId, {
      name: input.name,
      type: input.type,
      brand: input.brand,
      location: input.location,
      seats: input.seats,
      from_price: input.fromPrice,
      year: input.year,
      plate: input.plate?.toUpperCase(),
      specs: JSON.stringify(input.specs ?? []),
      status: "under_review",
      availability: "available",
    });
    if (input.tiers?.length) await premiumRepository.createTiers(row.id, input.tiers);
    const tiers = await premiumRepository.tiersForVehicle(row.id);
    return toVehicleDto(row, tiers);
  },

  async updateVehicleForBusiness(businessId: string, id: string, patch: any) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.name) dbPatch.name = patch.name;
    if (patch.availability) dbPatch.availability = patch.availability;
    if (patch.fromPrice) dbPatch.from_price = patch.fromPrice;
    if (patch.location) dbPatch.location = patch.location;
    if (patch.seats) dbPatch.seats = patch.seats;
    if (patch.year) dbPatch.year = patch.year;
    if (patch.plate) dbPatch.plate = patch.plate.toUpperCase();
    const [row] = await premiumRepository.updateVehicle(businessId, id, dbPatch);
    if (!row) throw new NotFoundError("Vehicle not found for this business");
    const tiers = await premiumRepository.tiersForVehicle(id);
    return toVehicleDto(row, tiers);
  },

  async bookingsForBusiness(businessId: string) {
    const rows = await premiumRepository.bookingsForBusiness(businessId);
    return Promise.all(
      rows.map(async (r) => {
        const [vehicle, tier] = await Promise.all([premiumRepository.findVehicle(r.vehicle_id), premiumRepository.findTier(r.tier_id)]);
        return toBookingDto(r, vehicle, tier);
      })
    );
  },

  async teamForBusiness(businessId: string) {
    return premiumRepository.teamForBusiness(businessId);
  },

  async inviteTeamMember(businessId: string, email: string, role: "manager" | "staff") {
    const [row] = await premiumRepository.inviteTeamMember(businessId, email, role);
    return { message: `Invite sent to ${email}`, member: row };
  },
};
