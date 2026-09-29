// Business-partner (premium-business) workflow: booking requests, timeline, handover, return inspection with
// deposit maths, per-tier pricing, per-day availability, earnings summary and payouts.
import { db } from "@/db/knex";
import { env } from "@/config/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/common/utils/errors";
import { shortName } from "@/common/utils/dto";
import { dateOnly, localDateString, startOfLocalMonth, addDays } from "@/common/utils/time";
import { dispatchNotification } from "@/jobs/dispatch";
import { eventBus, DomainEvents } from "@/events/eventBus";
import { premiumRepository, partnerRepository } from "./premium.repository";
import { computeDepositOutcome } from "./premium.deposit";

export interface PartnerContext {
  businessId: string;
  userId: string;
  role: "owner" | "manager" | "staff";
  business: any;
}

export function bookingReference(id: string): string {
  return `PR-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function addHours(time: string, hours: number): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = (h * 60 + m + hours * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function requireManage(ctx: PartnerContext): void {
  if (ctx.role === "staff") throw new ForbiddenError("Only an owner or manager can do this.");
}

function requireOwner(ctx: PartnerContext): void {
  if (ctx.role !== "owner") throw new ForbiddenError("Only the business owner can do this.");
}

function maskAccount(n?: string | null): string {
  return n ? `•••${n.slice(-4)}` : "";
}

const TAB_STATUSES: Record<string, string[] | undefined> = {
  requests: ["requested"],
  active: ["active"],
  upcoming: ["confirmed"],
  completed: ["completed"],
  all: undefined,
};

async function commissionPctFor(row: any): Promise<number> {
  return row.commission_pct !== null && row.commission_pct !== undefined ? Number(row.commission_pct) : await partnerRepository.commissionPct();
}

/** Business-facing booking DTO. Keeps every legacy field of the commuter DTO (deposit/serviceFee/total as numbers). */
export async function toPartnerBookingDto(row: any, businessId: string) {
  const [vehicle, tier, customer, deposit] = await Promise.all([
    premiumRepository.findVehicle(row.vehicle_id),
    row.tier_id ? premiumRepository.findTier(row.tier_id) : undefined,
    partnerRepository.commuterSummaryForBusiness(row.commuter_id, businessId),
    partnerRepository.depositForBooking(row.id),
  ]);
  const total = Number(row.total);
  const depositAmount = Number(row.deposit);
  const serviceFee = Number(row.service_fee);
  const rentalAmount = tier ? Number(tier.price) : total - depositAmount - serviceFee;
  const commissionPct = await commissionPctFor(row);
  const commissionAmount = Math.round((rentalAmount * commissionPct) / 100);
  const expiresInMinutes = row.status === "requested" && row.respond_by ? Math.max(0, Math.round((new Date(row.respond_by).getTime() - Date.now()) / 60000)) : null;

  return {
    id: row.id,
    reference: bookingReference(row.id),
    vehicle: vehicle
      ? {
          id: vehicle.id,
          name: vehicle.name,
          type: vehicle.type,
          brand: vehicle.brand,
          businessId: vehicle.business_id,
          location: vehicle.location,
          rating: Number(vehicle.rating),
          reviews: vehicle.reviews,
          fromPrice: Number(vehicle.from_price),
          availability: vehicle.availability,
          status: vehicle.status,
          seats: vehicle.seats ? `${vehicle.seats} seats` : undefined,
          year: vehicle.year ?? null,
          plate: vehicle.plate ?? null,
        }
      : undefined,
    tier: tier ? { id: tier.id, label: tier.label, sub: tier.sub, price: Number(tier.price) } : undefined,
    date: dateOnly(row.booking_date),
    startTime: row.start_time,
    endHours: row.duration_hours,
    endTime: addHours(row.start_time, row.duration_hours),
    status: row.status,
    occasion: row.occasion ?? null,
    pilotName: row.pilot_name ?? null,
    pilotRating: row.pilot_rating ? Number(row.pilot_rating) : null,
    customer: {
      name: shortName(customer),
      rating: customer ? Number(customer.rating) : 0,
      bookings: Number(customer?.bookings ?? 0),
      disputes: Number(customer?.disputes ?? 0),
    },
    // Legacy numeric fields (kobo) + explicit breakdown
    deposit: depositAmount,
    serviceFee,
    total,
    rentalAmount,
    commissionPct,
    commissionAmount,
    netAmount: rentalAmount - commissionAmount,
    depositInfo: {
      amount: depositAmount,
      status: deposit?.status ?? "held",
      claimAmount: Number(deposit?.claim_amount ?? 0),
      refundAmount: Number(deposit?.refund_amount ?? 0),
    },
    requestedAt: row.requested_at ?? null,
    respondBy: row.respond_by ?? null,
    expiresInMinutes,
    acceptedAt: row.accepted_at ?? null,
    declinedAt: row.declined_at ?? null,
    declineReason: row.decline_reason ?? null,
    returnedAt: row.returned_at ?? null,
    createdAt: row.created_at,
  };
}

async function loadBooking(ctx: PartnerContext, idOrRef: string) {
  await partnerRepository.expireStaleRequests();
  const resolved = await partnerRepository.resolveBookingId(ctx.businessId, idOrRef);
  if (resolved.ambiguous) throw new ConflictError("That booking reference is ambiguous — use the full booking id.");
  const row = resolved.id ? await partnerRepository.findBookingForBusiness(ctx.businessId, resolved.id) : undefined;
  if (!row) throw new NotFoundError("Booking not found");
  return row;
}

function buildTimeline(row: any, events: any[]) {
  const done = events.map((e) => ({
    key: e.kind,
    title: e.title,
    subtitle: e.subtitle ?? "",
    when: e.created_at,
    state: "done" as "done" | "now" | "pending",
  }));
  const pending: Array<{ key: string; title: string; subtitle: string; when: null; state: "done" | "now" | "pending" }> = [];
  const step = (key: string, title: string, subtitle: string, state: "now" | "pending") => pending.push({ key, title, subtitle, when: null, state });
  const dateLabel = `${dateOnly(row.booking_date)} · ${row.start_time}`;
  switch (row.status) {
    case "requested":
      step("awaiting", "Awaiting your response", row.respond_by ? `Respond before ${new Date(row.respond_by).toISOString()}` : "", "now");
      step("confirmed", "Booking confirmed", "", "pending");
      step("handover", "Vehicle handover", dateLabel, "pending");
      step("return", "Return & inspection", "", "pending");
      break;
    case "confirmed":
      step("handover", "Vehicle handover", dateLabel, "now");
      step("return", "Return & inspection", "", "pending");
      break;
    case "active":
      step("in_progress", "Rental in progress", "", "now");
      step("return", "Return & inspection", "", "pending");
      break;
    default:
      break;
  }
  return [...done, ...pending];
}

export const partnerService = {
  async contextForUser(userId: string): Promise<PartnerContext> {
    const business = await premiumRepository.businessForUser(userId);
    if (!business) throw new ForbiddenError("No business membership found for this account.");
    return { businessId: business.id, userId, role: business.member_role, business };
  },

  // ---------------- bookings ----------------

  async listBookings(ctx: PartnerContext, filter: { tab?: string; status?: string } = {}) {
    await partnerRepository.expireStaleRequests();
    const statuses = filter.status ? [filter.status] : TAB_STATUSES[filter.tab ?? "all"];
    const rows = await premiumRepository.bookingsForBusiness(ctx.businessId, statuses);
    return Promise.all(rows.map((r) => toPartnerBookingDto(r, ctx.businessId)));
  },

  /** Pending requests needing accept/decline, oldest deadline first. */
  async listRequests(ctx: PartnerContext) {
    await partnerRepository.expireStaleRequests();
    const rows = await db("premium_bookings").where({ business_id: ctx.businessId, status: "requested" }).orderBy("respond_by", "asc");
    return Promise.all(rows.map((r) => toPartnerBookingDto(r, ctx.businessId)));
  },

  async getBooking(ctx: PartnerContext, idOrRef: string) {
    return toPartnerBookingDto(await loadBooking(ctx, idOrRef), ctx.businessId);
  },

  async timeline(ctx: PartnerContext, idOrRef: string) {
    const row = await loadBooking(ctx, idOrRef);
    return buildTimeline(row, await partnerRepository.eventsForBooking(row.id));
  },

  async accept(ctx: PartnerContext, idOrRef: string) {
    requireManage(ctx);
    const row = await loadBooking(ctx, idOrRef);
    if (row.status === "confirmed") return toPartnerBookingDto(row, ctx.businessId); // idempotent
    if (row.status !== "requested") throw new ValidationError(`A ${row.status} booking cannot be accepted.`);

    const date = dateOnly(row.booking_date);
    if (await partnerRepository.isDayBlocked(row.vehicle_id, date)) throw new ValidationError("That day is blocked for this vehicle. Unblock it before accepting.");
    if (await partnerRepository.hasConfirmedOverlap(row.vehicle_id, date, row.id)) throw new ConflictError("This vehicle is already booked for that date.");

    const [updated] = await db("premium_bookings")
      .where({ id: row.id, status: "requested" })
      .andWhere("respond_by", ">", db.fn.now())
      .update({ status: "confirmed", accepted_at: db.fn.now(), updated_at: db.fn.now() })
      .returning("*");
    if (!updated) throw new ValidationError("This request has expired or was already answered.");

    await partnerRepository.recordEvent(row.id, "accepted", "Booking accepted", `Accepted by ${ctx.business.name}`, ctx.userId);
    await dispatchNotification({
      userId: row.commuter_id,
      title: "Booking confirmed",
      body: `${ctx.business.name} accepted your premium ride request.`,
      kind: "schedule",
    });
    return toPartnerBookingDto(updated, ctx.businessId);
  },

  async decline(ctx: PartnerContext, idOrRef: string, reason: string) {
    requireManage(ctx);
    const row = await loadBooking(ctx, idOrRef);
    if (row.status === "declined") return toPartnerBookingDto(row, ctx.businessId); // idempotent
    if (row.status !== "requested") throw new ValidationError(`A ${row.status} booking cannot be declined.`);

    const updated = await db.transaction(async (trx) => {
      const [u] = await trx("premium_bookings")
        .where({ id: row.id, status: "requested" })
        .update({ status: "declined", declined_at: trx.fn.now(), decline_reason: reason, updated_at: trx.fn.now() })
        .returning("*");
      if (!u) return undefined;
      // Nothing was captured for a request that never got confirmed: release the (notional) deposit hold.
      await trx("protection_deposits").where({ booking_id: row.id, status: "held" }).update({ status: "refunded", refund_amount: trx.raw("held_amount"), updated_at: trx.fn.now() });
      await partnerRepository.recordEvent(row.id, "declined", "Request declined", reason, ctx.userId, trx);
      return u;
    });
    if (!updated) throw new ValidationError("This request has expired or was already answered.");
    await dispatchNotification({
      userId: row.commuter_id,
      title: "Booking request declined",
      body: `${ctx.business.name} could not take your booking: ${reason}`,
      kind: "schedule",
    });
    return toPartnerBookingDto(updated, ctx.businessId);
  },

  /** Handover: confirmed -> active. */
  async start(ctx: PartnerContext, idOrRef: string) {
    requireManage(ctx);
    const row = await loadBooking(ctx, idOrRef);
    if (row.status === "active") return toPartnerBookingDto(row, ctx.businessId);
    if (row.status !== "confirmed") throw new ValidationError(`A ${row.status} booking cannot be started.`);
    const [updated] = await db("premium_bookings").where({ id: row.id, status: "confirmed" }).update({ status: "active", updated_at: db.fn.now() }).returning("*");
    if (!updated) throw new ConflictError("Booking changed state, please retry.");
    await partnerRepository.recordEvent(row.id, "started", "Vehicle handed over", undefined, ctx.userId);
    return toPartnerBookingDto(updated, ctx.businessId);
  },

  /**
   * Return inspection. One per booking (a second submit is a 409). Sets the booking to `completed` and records the
   * deposit outcome (see computeDepositOutcome). No money moves here: payment capture/release is not wired yet.
   */
  async submitInspection(
    ctx: PartnerContext,
    idOrRef: string,
    input: { items: Record<string, "ok" | "issue">; photos?: string[]; note?: string; claimAmount?: number }
  ) {
    requireManage(ctx);
    const row = await loadBooking(ctx, idOrRef);
    if (!["confirmed", "active"].includes(row.status)) {
      if (row.status === "completed" && (await partnerRepository.inspectionForBooking(row.id))) throw new ConflictError("An inspection was already submitted for this booking.");
      throw new ValidationError(`A ${row.status} booking cannot be inspected.`);
    }
    if (dateOnly(row.booking_date) > localDateString()) throw new ValidationError("This rental has not started yet.");

    const issueCount = Object.values(input.items).filter((v) => v === "issue").length;
    const deposit = await partnerRepository.depositForBooking(row.id);
    const held = deposit ? Number(deposit.held_amount) : Number(row.deposit);
    const outcome = computeDepositOutcome(held, input.claimAmount ?? 0, issueCount);

    await db.transaction(async (trx) => {
      const [claimed] = await trx("premium_bookings")
        .where({ id: row.id })
        .whereIn("status", ["confirmed", "active"])
        .update({ status: "completed", returned_at: trx.fn.now(), updated_at: trx.fn.now() })
        .returning("id");
      if (!claimed) throw new ConflictError("Booking changed state, please retry.");

      await trx("booking_inspections").insert({
        booking_id: row.id,
        submitted_by: ctx.userId,
        items: JSON.stringify(input.items),
        photos: JSON.stringify(input.photos ?? []),
        note: input.note ?? null,
        issue_count: issueCount,
        claim_amount: outcome.claimAmount,
      });

      const depositPatch = {
        claim_amount: outcome.claimAmount,
        refund_amount: outcome.refundAmount,
        status: outcome.status,
        inspection_note: input.note?.slice(0, 500) ?? null,
        updated_at: trx.fn.now(),
      };
      if (deposit) await trx("protection_deposits").where({ id: deposit.id }).update(depositPatch);
      else await trx("protection_deposits").insert({ booking_id: row.id, held_amount: held, ...depositPatch });

      await partnerRepository.recordEvent(row.id, "returned", "Vehicle returned", undefined, ctx.userId, trx);
      await partnerRepository.recordEvent(
        row.id,
        "inspected",
        "Return inspection submitted",
        issueCount ? `${issueCount} issue${issueCount === 1 ? "" : "s"} · claim ${outcome.claimAmount / 100}` : "No issues found",
        ctx.userId,
        trx
      );
      await partnerRepository.recordEvent(row.id, "completed", "Rental completed", undefined, ctx.userId, trx);
    });

    eventBus.publish(DomainEvents.PremiumBookingCompleted, { bookingId: row.id });
    await dispatchNotification({
      userId: row.commuter_id,
      title: "Rental completed",
      body: outcome.claimAmount
        ? "The partner reported an issue on return. Routta will review the protection deposit within 24 hours."
        : "Your protection deposit will be released in full.",
      kind: "schedule",
    });
    return {
      ok: true as const,
      id: row.id,
      reference: bookingReference(row.id),
      status: "completed" as const,
      issueCount,
      depositHeld: held,
      claimAmount: outcome.claimAmount,
      refundAmount: outcome.refundAmount,
      depositStatus: outcome.status,
    };
  },

  // ---------------- vehicles ----------------

  async getVehicle(ctx: PartnerContext, id: string) {
    const v = await premiumRepository.findVehicleForBusiness(ctx.businessId, id);
    if (!v) throw new NotFoundError("Vehicle not found for this business");
    return v;
  },

  /** Updates individual tier prices; from_price becomes the cheapest tier. Only this business's tiers can be touched. */
  async updateTiers(ctx: PartnerContext, vehicleId: string, tiers: Array<{ id: string; price: number; label?: string; sub?: string }>) {
    requireManage(ctx);
    const vehicle = await this.getVehicle(ctx, vehicleId);
    const existing = await premiumRepository.tiersForVehicle(vehicle.id);
    const ids = new Set(existing.map((t) => t.id));
    for (const t of tiers) if (!ids.has(t.id)) throw new ValidationError(`Tier ${t.id} does not belong to this vehicle.`);
    await db.transaction(async (trx) => {
      for (const t of tiers) {
        await trx("premium_tiers")
          .where({ id: t.id, vehicle_id: vehicle.id })
          .update({ price: t.price, ...(t.label ? { label: t.label } : {}), ...(t.sub !== undefined ? { sub: t.sub } : {}) });
      }
      const min = await trx("premium_tiers").where({ vehicle_id: vehicle.id }).min<{ m: string }>("price as m").first();
      await trx("premium_vehicles").where({ id: vehicle.id }).update({ from_price: Number(min?.m ?? vehicle.from_price), updated_at: trx.fn.now() });
    });
    return { vehicleId: vehicle.id, tiers: (await premiumRepository.tiersForVehicle(vehicle.id)).map((t) => ({ id: t.id, label: t.label, sub: t.sub, price: Number(t.price) })) };
  },

  // ---------------- availability ----------------

  async getAvailability(ctx: PartnerContext, vehicleId: string, month: string) {
    const vehicle = await this.getVehicle(ctx, vehicleId);
    const { from, to } = monthRange(month);
    const [blocked, booked] = await Promise.all([partnerRepository.blockedDaysInRange(vehicle.id, from, to), partnerRepository.bookedDaysInRange(vehicle.id, from, to)]);
    return {
      vehicleId: vehicle.id,
      month,
      blockedDays: blocked.map((b: any) => Number(b.day.slice(8, 10))),
      blocked: blocked.map((b: any) => ({ date: b.day, reason: b.reason })),
      bookedDays: [...new Set(booked.map((b: any) => Number(b.day.slice(8, 10))))].sort((a, b) => a - b),
    };
  },

  /** Replaces the blocked days of one month (days are day-of-month numbers). Days with confirmed/active bookings can't be blocked. */
  async setBlockedDays(ctx: PartnerContext, vehicleId: string, month: string, days: number[]) {
    requireManage(ctx);
    const vehicle = await this.getVehicle(ctx, vehicleId);
    const { from, to, daysInMonth } = monthRange(month);
    const unique = [...new Set(days)].sort((a, b) => a - b);
    for (const d of unique) if (d < 1 || d > daysInMonth) throw new ValidationError(`Day ${d} is not valid for ${month}.`);
    const dates = unique.map((d) => `${month}-${String(d).padStart(2, "0")}`);
    const booked = (await partnerRepository.bookedDaysInRange(vehicle.id, from, to)).filter((b: any) => ["confirmed", "active"].includes(b.status)).map((b: any) => b.day);
    const clash = dates.filter((d) => booked.includes(d));
    if (clash.length) throw new ConflictError(`Cannot block days with confirmed bookings: ${clash.join(", ")}`);
    await partnerRepository.setBlockedDays(vehicle.id, from, to, dates);
    return this.getAvailability(ctx, vehicleId, month);
  },

  async blockDay(ctx: PartnerContext, vehicleId: string, date: string, reason?: string) {
    requireManage(ctx);
    const vehicle = await this.getVehicle(ctx, vehicleId);
    if (await partnerRepository.hasConfirmedOverlap(vehicle.id, date)) throw new ConflictError("That day has a confirmed booking.");
    await partnerRepository.blockDay(vehicle.id, date, reason);
    return this.getAvailability(ctx, vehicleId, date.slice(0, 7));
  },

  async unblockDay(ctx: PartnerContext, vehicleId: string, date: string) {
    requireManage(ctx);
    const vehicle = await this.getVehicle(ctx, vehicleId);
    await partnerRepository.unblockDay(vehicle.id, date);
    return this.getAvailability(ctx, vehicleId, date.slice(0, 7));
  },

  // ---------------- settings ----------------

  getSettings(ctx: PartnerContext) {
    return { bookingMode: ctx.business.booking_mode as "instant" | "request", requestResponseHours: env.bookingRequestTtlHours, role: ctx.role };
  },

  /** bookingMode: "instant" auto-confirms bookings (default). "request" makes every new booking wait for accept/decline. */
  async updateSettings(ctx: PartnerContext, patch: { bookingMode?: "instant" | "request" }) {
    requireManage(ctx);
    if (patch.bookingMode) {
      const [row] = await partnerRepository.updateBusinessSettings(ctx.businessId, { booking_mode: patch.bookingMode });
      ctx.business = { ...ctx.business, ...row };
    }
    return this.getSettings(ctx);
  },

  // ---------------- earnings & payouts ----------------

  /**
   * Amounts in kobo. Month = current app-local calendar month, by booking date, completed bookings only.
   *   grossRevenue    = sum of rental price (tier price) of completed bookings
   *   commission      = gross * commission_pct snapshot
   *   netEarnings     = gross - commission
   *   monthAdjusted   = damage claims Routta approved (deposit status "claimed") this month, credited to the partner
   *   monthNet        = netEarnings + monthAdjusted
   *   depositsHeld    = open protection deposits (held or awaiting review) across live bookings
   *   depositsRefunded= deposit refunds recorded this month
   */
  async earningsSummary(ctx: PartnerContext) {
    const monthStart = startOfLocalMonth();
    const from = localDateString(monthStart);
    const to = localDateString(addDays(startOfLocalMonth(addDays(monthStart, 32)), 0));
    const [rows, held, next] = await Promise.all([
      partnerRepository.completedBookingsBetween(ctx.businessId, from, to),
      partnerRepository.openDepositsHeld(ctx.businessId),
      partnerRepository.nextScheduledSettlement(ctx.businessId),
    ]);
    let gross = 0;
    let commission = 0;
    let approvedDamage = 0;
    let refunded = 0;
    const defaultPct = await partnerRepository.commissionPct();
    for (const r of rows) {
      const rental = r.tier_price !== null && r.tier_price !== undefined ? Number(r.tier_price) : Number(r.total) - Number(r.deposit) - Number(r.service_fee);
      const pct = r.commission_pct !== null && r.commission_pct !== undefined ? Number(r.commission_pct) : defaultPct;
      gross += rental;
      commission += Math.round((rental * pct) / 100);
      if (r.deposit_status === "claimed") approvedDamage += Number(r.claim_amount ?? 0);
      if (["refunded", "partially_refunded"].includes(r.deposit_status)) refunded += Number(r.refund_amount ?? 0);
    }
    const net = gross - commission;
    const b = ctx.business;
    return {
      nextPayoutAmount: next ? Number(next.payable) : 0,
      nextPayoutDate: next ? dateOnly(next.period_end) : null,
      payoutAccountMasked: b.payout_account_number ? `${b.payout_bank_name ?? "Bank"} ${maskAccount(b.payout_account_number)}` : "",
      monthRentals: rows.length,
      monthNet: net + approvedDamage,
      monthAdjusted: approvedDamage,
      grossRevenue: gross,
      commission,
      netEarnings: net,
      depositsHeld: held,
      depositsRefunded: refunded,
      approvedDamage,
    };
  },

  async payouts(ctx: PartnerContext) {
    const rows = await partnerRepository.settlementsForBusiness(ctx.businessId);
    return rows.map((s: any) => ({
      id: s.id,
      period: periodLabel(s.period_start_d, s.period_end_d),
      periodStart: s.period_start_d,
      periodEnd: s.period_end_d,
      count: Number(s.bookings_count),
      gross: Number(s.gross),
      commission: Number(s.commission),
      adjustment: Number(s.adjustment),
      amount: Number(s.payable),
      status: s.status as "scheduled" | "on_hold" | "paid",
      paidAt: s.paid_at ?? null,
    }));
  },

  getPayoutAccount(ctx: PartnerContext) {
    const b = ctx.business;
    if (!b.payout_account_number) return null;
    return { bankName: b.payout_bank_name, bankCode: b.payout_bank_code ?? null, accountName: b.payout_account_name, accountNumberMasked: maskAccount(b.payout_account_number) };
  },

  /** TODO(monnify): verify the account name via Monnify name enquiry before accepting. */
  async setPayoutAccount(ctx: PartnerContext, input: { bankName: string; bankCode?: string; accountNumber: string; accountName: string }) {
    requireOwner(ctx);
    const [row] = await partnerRepository.updateBusinessSettings(ctx.businessId, {
      payout_bank_name: input.bankName,
      payout_bank_code: input.bankCode ?? null,
      payout_account_number: input.accountNumber,
      payout_account_name: input.accountName,
    });
    ctx.business = { ...ctx.business, ...row };
    return this.getPayoutAccount(ctx);
  },
};

function monthRange(month: string): { from: string; to: string; daysInMonth: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new ValidationError("month must be YYYY-MM");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01`, daysInMonth: new Date(Date.UTC(y, mo, 0)).getUTCDate() };
}

function periodLabel(start: string, end: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}
